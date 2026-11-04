import * as ts from 'typescript';

/**
 * Analizador estático (feature 015) de escrituras a la base con la API del compilador de TypeScript.
 *
 * Unidad: MethodDeclaration, Constructor, FunctionDeclaration o función asignada a una variable de primer
 * nivel. Las funciones anidadas (callbacks de map, Promise.all, ...) cuentan para la unidad que las contiene.
 *
 * Reglas:
 *  A. Fuera de $transaction, la unidad suma 2 o más escrituras y al menos una no es terminal
 *     (terminal = la expresión directa de un `return` o el cuerpo de una arrow function). Una escritura dentro de
 *     un bucle o de un callback de map/forEach/flatMap cuenta como 2.
 *  B. Dentro de un callback de $transaction no aparece this.prisma, prisma ni this.db (solo el parámetro tx).
 *  C. No existe la forma de arreglo $transaction([...]).
 *
 * Limitaciones: las escrituras a través de un helper que no siga los nombres de abajo no se ven; dos escrituras
 * en ramas excluyentes que no terminan en `return` dan falso positivo (se resuelve con `return` o con la lista
 * blanca del spec).
 */

export const WRITE_OPS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);
const CLIENTS = new Set(['this.prisma', 'prisma', 'this.db', 'db']);
const TX_FORBIDDEN_CLIENTS = new Set(['this.prisma', 'prisma', 'this.db']);
const RAW_WRITES = new Set(['$executeRaw', '$executeRawUnsafe']);
const DELEGATED_OWNER = /^this\.\w+Service$/;
const DELEGATED_METHOD = /^(create|update|delete|upsert|remove|merge|save)/;
const ITERATORS = new Set(['map', 'forEach', 'flatMap']);

export interface UnitReport {
  /** Clase.método (o nombre de la función). */
  name: string;
  /** Escrituras fuera de transacción, con multiplicidad. */
  writesOutsideTx: number;
  nonTerminalOutsideTx: number;
  ruleA: boolean;
  /** Usos prohibidos del cliente raíz dentro de un callback de $transaction (regla B). */
  ruleB: string[];
  ruleC: boolean;
}

const isFunctionLike = (
  n: ts.Node,
): n is ts.ArrowFunction | ts.FunctionExpression =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n);

const calleeName = (call: ts.CallExpression): string | undefined =>
  ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : undefined;

/** ¿`fn` es un argumento función de una llamada a *.$transaction? */
const isTxCallback = (
  fn: ts.Node,
): fn is ts.ArrowFunction | ts.FunctionExpression =>
  isFunctionLike(fn) &&
  ts.isCallExpression(fn.parent) &&
  calleeName(fn.parent) === '$transaction' &&
  fn.parent.arguments.includes(fn);

const isWrite = (call: ts.CallExpression): boolean => {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  // C.$executeRaw(...)
  if (RAW_WRITES.has(callee.name.text))
    return CLIENTS.has(callee.expression.getText());
  // C.<modelo>.<op>(...)
  if (
    WRITE_OPS.has(callee.name.text) &&
    ts.isPropertyAccessExpression(callee.expression) &&
    CLIENTS.has(callee.expression.expression.getText())
  )
    return true;
  // this.<x>Service.<m>(...)
  return (
    DELEGATED_OWNER.test(callee.expression.getText()) &&
    DELEGATED_METHOD.test(callee.name.text)
  );
};

const isTerminal = (call: ts.CallExpression): boolean => {
  let node: ts.Node = call;
  if (ts.isAwaitExpression(node.parent)) node = node.parent;
  const parent = node.parent;
  if (ts.isReturnStatement(parent)) return parent.expression === node;
  if (ts.isArrowFunction(parent)) return parent.body === node;
  return false;
};

const isUnit = (n: ts.Node): boolean =>
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isFunctionDeclaration(n) ||
  (ts.isVariableDeclaration(n) &&
    ts.isVariableDeclarationList(n.parent) &&
    ts.isVariableStatement(n.parent.parent) &&
    ts.isSourceFile(n.parent.parent.parent) &&
    !!n.initializer &&
    isFunctionLike(n.initializer));

const unitName = (n: ts.Node): string => {
  let cls = '';
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isClassDeclaration(p) || ts.isClassExpression(p)) {
      cls = p.name?.text ?? '<anon>';
      break;
    }
  }
  let own = '<anon>';
  if (ts.isConstructorDeclaration(n)) own = 'constructor';
  else if (
    (ts.isMethodDeclaration(n) ||
      ts.isFunctionDeclaration(n) ||
      ts.isVariableDeclaration(n)) &&
    n.name &&
    ts.isIdentifier(n.name)
  )
    own = n.name.text;
  return cls ? `${cls}.${own}` : own;
};

const analyzeUnit = (unit: ts.Node): UnitReport => {
  const report: UnitReport = {
    name: unitName(unit),
    writesOutsideTx: 0,
    nonTerminalOutsideTx: 0,
    ruleA: false,
    ruleB: [],
    ruleC: false,
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (
        calleeName(node) === '$transaction' &&
        node.arguments[0] &&
        ts.isArrayLiteralExpression(node.arguments[0])
      )
        report.ruleC = true;

      if (isWrite(node)) {
        let inTx = false;
        let multiple = false;
        for (let p: ts.Node = node.parent; p && p !== unit; p = p.parent) {
          if (isTxCallback(p)) inTx = true;
          if (
            ts.isForStatement(p) ||
            ts.isForOfStatement(p) ||
            ts.isForInStatement(p) ||
            ts.isWhileStatement(p) ||
            ts.isDoStatement(p)
          )
            multiple = true;
          if (
            isFunctionLike(p) &&
            ts.isCallExpression(p.parent) &&
            ITERATORS.has(calleeName(p.parent) ?? '')
          )
            multiple = true;
        }
        if (!inTx) {
          report.writesOutsideTx += multiple ? 2 : 1;
          if (multiple || !isTerminal(node)) report.nonTerminalOutsideTx += 1;
        }
      }
    }

    // Regla B: cliente raíz dentro de un callback de $transaction
    if (
      ts.isPropertyAccessExpression(node) &&
      TX_FORBIDDEN_CLIENTS.has(node.expression.getText())
    ) {
      for (let p: ts.Node = node.parent; p && p !== unit; p = p.parent) {
        if (isTxCallback(p)) {
          const first = p.parameters[0];
          // `prisma` como parámetro del propio callback no es el cliente raíz
          if (first?.name.getText() !== node.expression.getText())
            report.ruleB.push(node.getText().split('(')[0]);
          break;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(unit, visit);

  report.ruleA =
    report.writesOutsideTx >= 2 && report.nonTerminalOutsideTx >= 1;
  return report;
};

/** Analiza un archivo (o un fragmento) y devuelve un informe por unidad. */
export function analyzeSource(fileName: string, text: string): UnitReport[] {
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const units: UnitReport[] = [];
  const find = (node: ts.Node) => {
    if (isUnit(node)) {
      units.push(analyzeUnit(node));
      return; // lo anidado cuenta para esta unidad
    }
    ts.forEachChild(node, find);
  };
  find(sf);
  return units;
}
