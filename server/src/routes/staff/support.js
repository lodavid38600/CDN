import { Router } from 'express';
import mongoose from 'mongoose';
import { Ticket, ChatMessage, ChatThread } from '../../models/Support.js';
import { User } from '../../models/User.js';
import { requirePerm } from '../../services/access.js';
import { audit } from '../../services/audit.js';

// Traitement des tickets et du chat des clients.
const router = Router();
router.use(requirePerm('support.manage'));
const STATUSES = ['ouvert', 'en_cours', 'attente_client', 'resolu', 'ferme'];
const PRIORITIES = ['basse', 'normale', 'haute', 'urgente'];
const validId = (id) => mongoose.isValidObjectId(id);

router.get('/tickets', async (req, res) => {
  const q = {};
  if (req.query.status === 'actifs') q.status = { $in: ['ouvert', 'en_cours', 'attente_client'] };
  else if (STATUSES.includes(req.query.status)) q.status = req.query.status;
  if (PRIORITIES.includes(req.query.priority)) q.priority = req.query.priority;
  if (validId(req.query.company)) q.company = req.query.company;
  if (req.query.assignee === 'moi') q.assignee = req.user._id;
  else if (req.query.assignee === 'personne') q.assignee = null;
  if (req.query.unread === 'true') q.unreadStaff = true;
  if (req.query.q) {
    const n = Number(req.query.q);
    q.$or = [{ subject: new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, ...(Number.isInteger(n) ? [{ number: n }] : [])];
  }
  const tickets = await Ticket.find(q, { messages: 0 }).sort({ unreadStaff: -1, lastActivityAt: -1 }).limit(300)
    .populate('company', 'name plan').populate('author', 'name email').populate('assignee', 'name email').lean();
  res.json(tickets);
});

async function ticket(req, res) {
  if (!validId(req.params.id)) { res.status(404).json({ error: 'Ticket introuvable' }); return null; }
  const t = await Ticket.findById(req.params.id);
  if (!t) res.status(404).json({ error: 'Ticket introuvable' });
  return t;
}
const full = (id) => Ticket.findById(id).populate('company', 'name plan').populate('author', 'name email').populate('assignee', 'name email').lean();

router.get('/tickets/:id', async (req, res) => {
  const t = await ticket(req, res);
  if (!t) return;
  if (t.unreadStaff) { t.unreadStaff = false; await t.save(); }
  res.json(await full(t._id));
});

router.post('/tickets/:id/messages', async (req, res) => {
  const t = await ticket(req, res);
  if (!t) return;
  const body = String(req.body?.body || '').trim().slice(0, 10000);
  if (!body) return res.status(400).json({ error: 'Message vide' });
  const internal = req.body?.internal === true;
  t.messages.push({ author: req.user._id, authorName: req.user.name || req.user.email, staff: true, internal, body });
  if (!internal) {
    t.unreadClient = true;
    if (t.status === 'ouvert') t.status = 'en_cours';
  }
  if (!t.assignee) t.assignee = req.user._id;
  t.lastActivityAt = new Date();
  await t.save();
  await audit(req, { action: internal ? 'ticket.note-interne' : 'ticket.reponse-equipe', category: 'support', company: t.company, target: `ticket #${t.number}`, message: `${internal ? 'Note interne' : 'Réponse'} sur le ticket #${t.number}` });
  res.json(await full(t._id));
});

router.put('/tickets/:id', async (req, res) => {
  const t = await ticket(req, res);
  if (!t) return;
  const b = req.body || {};
  const changes = {};
  if (STATUSES.includes(b.status) && b.status !== t.status) changes.status = t.status = b.status;
  if (PRIORITIES.includes(b.priority) && b.priority !== t.priority) changes.priority = t.priority = b.priority;
  if (b.assignee !== undefined) {
    const ok = b.assignee === null || (validId(b.assignee) && (await User.exists({ _id: b.assignee, staffRole: { $ne: null } })));
    if (!ok) return res.status(400).json({ error: 'Assignation impossible' });
    changes.assignee = t.assignee = b.assignee;
  }
  if (changes.status && ['resolu', 'attente_client'].includes(changes.status)) t.unreadClient = true;
  t.lastActivityAt = new Date();
  await t.save();
  await audit(req, { action: 'ticket.modifie', category: 'support', company: t.company, target: `ticket #${t.number}`, message: `Ticket #${t.number} modifié`, details: changes });
  res.json(await full(t._id));
});

// --- Chat
router.get('/chat', async (req, res) => {
  const threads = await ChatThread.find({ lastMessageAt: { $ne: null } }).sort({ unreadStaff: -1, lastMessageAt: -1 }).limit(200).populate('company', 'name plan').lean();
  res.json(threads);
});

router.get('/chat/:company', async (req, res) => {
  if (!validId(req.params.company)) return res.status(404).json({ error: 'Conversation introuvable' });
  const after = req.query.after ? new Date(String(req.query.after)) : null;
  const q = { company: req.params.company, ...(after && !Number.isNaN(after.getTime()) ? { at: { $gt: after } } : {}) };
  const messages = (await ChatMessage.find(q).sort({ at: -1 }).limit(200).lean()).reverse();
  await ChatThread.updateOne({ company: req.params.company }, { $set: { unreadStaff: 0 } });
  res.json(messages);
});

router.post('/chat/:company', async (req, res) => {
  if (!validId(req.params.company)) return res.status(404).json({ error: 'Conversation introuvable' });
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (!body) return res.status(400).json({ error: 'Message vide' });
  const m = await ChatMessage.create({ company: req.params.company, author: req.user._id, authorName: req.user.name || 'Équipe', staff: true, body });
  await ChatThread.updateOne({ company: req.params.company }, { $set: { lastMessageAt: m.at, lastMessage: body.slice(0, 140) }, $inc: { unreadClient: 1 } }, { upsert: true });
  res.status(201).json(m);
});

export default router;
