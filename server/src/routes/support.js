import { Router } from 'express';
import mongoose from 'mongoose';
import { Ticket, ChatMessage, ChatThread } from '../models/Support.js';
import { nextSeq } from '../models/System.js';
import { audit } from '../services/audit.js';

// Assistance côté client : tickets et chat avec l'équipe. Un responsable voit tous les tickets
// de sa société, un membre les siens.
const router = Router();
const CATEGORIES = ['question', 'donnees', 'facturation', 'compte', 'technique', 'suggestion'];
const PRIORITIES = ['basse', 'normale', 'haute', 'urgente'];

router.use((req, res, next) => (req.company ? next() : res.status(404).json({ error: 'Aucune société rattachée à ce compte' })));

const scopeOf = (req) => (req.access.perms.has('company.manage') ? { company: req.company._id } : { company: req.company._id, author: req.user._id });
const clientView = (t) => ({ ...t, id: String(t._id), messages: (t.messages || []).filter((m) => !m.internal) });

router.get('/tickets', async (req, res) => {
  const q = scopeOf(req);
  if (req.query.status === 'ouverts') q.status = { $in: ['ouvert', 'en_cours', 'attente_client'] };
  else if (req.query.status === 'fermes') q.status = { $in: ['resolu', 'ferme'] };
  const tickets = await Ticket.find(q, { messages: 0 }).sort({ lastActivityAt: -1 }).limit(200).populate('author', 'name email').lean();
  res.json(tickets.map((t) => ({ ...t, id: String(t._id) })));
});

router.post('/tickets', async (req, res) => {
  const subject = String(req.body?.subject || '').trim().slice(0, 200);
  const body = String(req.body?.body || '').trim().slice(0, 10000);
  if (!subject || !body) return res.status(400).json({ error: 'Objet et message obligatoires' });
  const t = await Ticket.create({
    number: await nextSeq('ticket'), company: req.company._id, author: req.user._id, subject,
    category: CATEGORIES.includes(req.body?.category) ? req.body.category : 'question',
    priority: PRIORITIES.includes(req.body?.priority) ? req.body.priority : 'normale',
    messages: [{ author: req.user._id, authorName: req.user.name || req.user.email, body }],
  });
  await audit(req, { action: 'ticket.cree', category: 'support', target: `ticket #${t.number}`, message: `Ticket #${t.number} ouvert : ${subject}` });
  res.status(201).json(clientView(t.toObject()));
});

async function ticketOf(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).json({ error: 'Ticket introuvable' }); return null; }
  const t = await Ticket.findOne({ _id: req.params.id, ...scopeOf(req) });
  if (!t) res.status(404).json({ error: 'Ticket introuvable' });
  return t;
}

router.get('/tickets/:id', async (req, res) => {
  const t = await ticketOf(req, res);
  if (!t) return;
  if (t.unreadClient) { t.unreadClient = false; await t.save(); }
  res.json(clientView(t.toObject()));
});

router.post('/tickets/:id/messages', async (req, res) => {
  const t = await ticketOf(req, res);
  if (!t) return;
  const body = String(req.body?.body || '').trim().slice(0, 10000);
  if (!body) return res.status(400).json({ error: 'Message vide' });
  if (t.status === 'ferme') return res.status(409).json({ error: 'Ticket fermé : ouvrez un nouveau ticket.' });
  t.messages.push({ author: req.user._id, authorName: req.user.name || req.user.email, body });
  if (['attente_client', 'resolu'].includes(t.status)) t.status = 'ouvert';
  t.lastActivityAt = new Date();
  t.unreadStaff = true;
  await t.save();
  await audit(req, { action: 'ticket.reponse-client', category: 'support', target: `ticket #${t.number}`, message: `Réponse du client sur le ticket #${t.number}` });
  res.json(clientView(t.toObject()));
});

router.post('/tickets/:id/close', async (req, res) => {
  const t = await ticketOf(req, res);
  if (!t) return;
  t.status = 'ferme';
  t.lastActivityAt = new Date();
  await t.save();
  await audit(req, { action: 'ticket.ferme-client', category: 'support', target: `ticket #${t.number}`, message: `Ticket #${t.number} fermé par le client` });
  res.json(clientView(t.toObject()));
});

// --- Chat
router.get('/chat', async (req, res) => {
  const after = req.query.after ? new Date(String(req.query.after)) : null;
  const q = { company: req.company._id, ...(after && !Number.isNaN(after.getTime()) ? { at: { $gt: after } } : {}) };
  const messages = (await ChatMessage.find(q).sort({ at: -1 }).limit(100).lean()).reverse();
  await ChatThread.updateOne({ company: req.company._id }, { $set: { unreadClient: 0 } });
  res.json(messages);
});

router.post('/chat', async (req, res) => {
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (!body) return res.status(400).json({ error: 'Message vide' });
  const m = await ChatMessage.create({ company: req.company._id, author: req.user._id, authorName: req.user.name || req.user.email, body });
  await ChatThread.updateOne({ company: req.company._id }, { $set: { lastMessageAt: m.at, lastMessage: body.slice(0, 140) }, $inc: { unreadStaff: 1 } }, { upsert: true });
  res.status(201).json(m);
});

router.get('/unread', async (req, res) => {
  const [tickets, thread] = await Promise.all([
    Ticket.countDocuments({ ...scopeOf(req), unreadClient: true }),
    ChatThread.findOne({ company: req.company._id }).lean(),
  ]);
  res.json({ tickets, chat: thread?.unreadClient || 0 });
});

export default router;
