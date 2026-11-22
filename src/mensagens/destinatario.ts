/** O servidor guarda "*" para a mensagem que vale para todas as IAs; ao dono, isso se lê "Todas as IAs". */
export function rotuloDoDestinatario(para: string): string {
  return para.trim() === '*' ? 'Todas as IAs' : para;
}
