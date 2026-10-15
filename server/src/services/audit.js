import { AuditLog } from '../models/AuditLog.js';

/**
 * Inscrit une entrée au journal d'activité. Ne fait jamais échouer la requête appelante.
 * @param {import('express').Request|null} req requête (acteur, société, adresse IP), ou null (tâche système)
 */
export function audit(req, { action, category, level = 'info', target, message, company, details, actor } = {}) {
  const user = actor || req?.user;
  return AuditLog.create({
    action, category, level, target, message, details,
    actor: user?._id, actorEmail: user?.email,
    company: company ?? user?.companyId,
    ip: req?.ip,
  }).catch((e) => console.error('Journal :', e.message));
}
