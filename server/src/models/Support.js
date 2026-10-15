import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

const messageSchema = new mongoose.Schema(
  {
    author: { type: ObjectId, ref: 'User' },
    authorName: String,
    staff: { type: Boolean, default: false }, // message de l'équipe
    internal: { type: Boolean, default: false }, // note interne : jamais montrée au client
    body: { type: String, required: true, maxlength: 10000 },
    at: { type: Date, default: Date.now },
  },
  { _id: true, versionKey: false }
);

// Ticket d'assistance d'une société
const ticketSchema = new mongoose.Schema(
  {
    number: { type: Number, unique: true },
    company: { type: ObjectId, ref: 'Company', required: true, index: true },
    author: { type: ObjectId, ref: 'User', required: true },
    subject: { type: String, required: true, maxlength: 200 },
    category: { type: String, enum: ['question', 'donnees', 'facturation', 'compte', 'technique', 'suggestion'], default: 'question' },
    priority: { type: String, enum: ['basse', 'normale', 'haute', 'urgente'], default: 'normale' },
    status: { type: String, enum: ['ouvert', 'en_cours', 'attente_client', 'resolu', 'ferme'], default: 'ouvert', index: true },
    assignee: { type: ObjectId, ref: 'User' },
    messages: { type: [messageSchema], default: [] },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    unreadStaff: { type: Boolean, default: true },
    unreadClient: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);
export const Ticket = mongoose.model('Ticket', ticketSchema);

// Chat : un fil par société
const chatMessageSchema = new mongoose.Schema(
  {
    company: { type: ObjectId, ref: 'Company', required: true },
    author: { type: ObjectId, ref: 'User' },
    authorName: String,
    staff: { type: Boolean, default: false },
    body: { type: String, required: true, maxlength: 4000 },
    at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);
chatMessageSchema.index({ company: 1, at: -1 });
export const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

const chatThreadSchema = new mongoose.Schema(
  {
    company: { type: ObjectId, ref: 'Company', required: true, unique: true },
    lastMessageAt: Date,
    lastMessage: String,
    unreadStaff: { type: Number, default: 0 },
    unreadClient: { type: Number, default: 0 },
  },
  { versionKey: false }
);
export const ChatThread = mongoose.model('ChatThread', chatThreadSchema);
