import { Invoice } from '../models/Invoice.js';

/** Factures émises dont l'échéance est dépassée → « en retard ». */
export function markOverdue(now = new Date()) {
  return Invoice.updateMany({ status: 'emise', dueDate: { $lt: now } }, { $set: { status: 'en_retard' } });
}
