export type WorkItem = {
    id: string
    date: Date
    patientName: string
    professionalName: string
    payer: string
    service: string
    status: 'Pending' | 'Paid' | 'Rejected'
    notes?: string
    amount: number
    splitProfessional: number
    splitPractice: number
}
