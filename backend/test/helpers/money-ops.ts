import * as ts from 'typescript';

/**
 * Analizador estático (feature 017, criterio 1) de aritmética de dinero con `number`, con la API del compilador
 * de TypeScript (mismo enfoque que prisma-writes.ts del 015).
 *
 * Reglas, aplicadas a los archivos de MONEY_FILES:
 *  M1. No hay llamadas a Number(), parseFloat(), parseInt(), Math.*() ni .toFixed().
 *  M2. No hay aritmética binaria (+ - * / += -= *= /=) en la que un operando mencione (en cualquier nivel)
 *      un identificador o una propiedad cuyo nombre parezca dinero (MONEY_NAME).
 *
 * Límites: no usa el type checker, así que una variable de dinero con un nombre fuera del patrón no se ve. Se
 * compensa con los tests de montos exactos y de tipos de la respuesta.
 */
export const MONEY_NAME =
  /amount|gross|net|fee|payout|total|commission|pending|cash|share|retention|base|pct|percent|allocated|took|debt|value/i;

export interface MoneyFinding {
  rule: 'M1' | 'M2';
  /** Texto exacto de la expresión (recortado a una línea), para la lista blanca. */
  text: string;
  line: number;
}

const ARITHMETIC = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
]);

const BANNED_FUNCTIONS = new Set(['Number', 'parseFloat', 'parseInt']);

const oneLine = (text: string) =>
  text.replace(/\s+/g, ' ').trim().slice(0, 120);

/** true si algún identificador o propiedad del operando (en cualquier nivel) tiene nombre de dinero. */
const mentionsMoney = (e: ts.Node): boolean => {
  if (ts.isIdentifier(e) && MONEY_NAME.test(e.text)) return true;
  if (ts.isPropertyAccessExpression(e) && MONEY_NAME.test(e.name.text))
    return true;
  return (
    ts.forEachChild(e, (c) => (mentionsMoney(c) ? true : undefined)) === true
  );
};

export function analyzeMoneySource(
  fileName: string,
  text: string,
): MoneyFinding[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const out: MoneyFinding[] = [];
  const lineOf = (n: ts.Node) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const calleeText = callee.getText(sf);
      const banned =
        (ts.isIdentifier(callee) && BANNED_FUNCTIONS.has(callee.text)) ||
        calleeText.startsWith('Math.') ||
        calleeText.startsWith('Number.parse') ||
        (ts.isPropertyAccessExpression(callee) &&
          callee.name.text === 'toFixed');
      if (banned)
        out.push({ rule: 'M1', text: oneLine(n.getText(sf)), line: lineOf(n) });
    }
    if (ts.isBinaryExpression(n) && ARITHMETIC.has(n.operatorToken.kind)) {
      if (mentionsMoney(n.left) || mentionsMoney(n.right)) {
        out.push({ rule: 'M2', text: oneLine(n.getText(sf)), line: lineOf(n) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Cantidad de llamadas a funciones del helper común (control contra un detector ciego). */
export function countMoneyHelperCalls(text: string): number {
  const re =
    /\b(money|roundMoney|sumMoney|percentOf|distributeByPercentages|toJsonNumber)\(/g;
  return (text.match(re) ?? []).length;
}
