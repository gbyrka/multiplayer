import { el } from './dom.mjs';
import { randomToken } from './random.mjs';
import { CHAT_LIMITS, normalizeChatText } from './chat.mjs';

/** A persistent panel: game renders never replace its draft, focus or scroll position. */
export class ChatPanel {
  constructor(onSend) {
    this.onSend = onSend;
    this.connected = false;
    this.revision = -1;
    this.unread = 0;
    this.log = el('ol', { class: 'chat-messages', role: 'log', 'aria-label': 'Room messages', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-atomic': 'false', tabindex: '0' });
    this.empty = el('p', { class: 'chat-empty' }, el('span', { 'aria-hidden': 'true' }, '☷'), 'A little conversation makes a good table.', el('small', {}, 'Say hello to your friends.'));
    this.newMessages = el('button', { type: 'button', class: 'chat-new button', hidden: true }, 'New messages ↓');
    this.input = el('textarea', { id: 'chat-input', class: 'chat-input', rows: '3', maxlength: CHAT_LIMITS.length, placeholder: 'Say something to the table…', 'aria-describedby': 'chat-help chat-count', autocomplete: 'off', disabled: true });
    this.count = el('span', { id: 'chat-count' }, `0 / ${CHAT_LIMITS.length}`);
    this.sendButton = el('button', { type: 'submit', class: 'button primary chat-send', disabled: true }, 'SEND', el('span', { 'aria-hidden': 'true' }, '↑'));
    this.error = el('p', { class: 'chat-error', role: 'alert', hidden: true });
    this.form = el('form', { id: 'chat-form', class: 'chat-form' },
      el('label', { for: 'chat-input' }, 'YOUR MESSAGE'), this.input,
      el('div', { class: 'chat-compose-bottom' }, this.count, this.sendButton),
      el('p', { id: 'chat-help', class: 'chat-help' }, 'Enter to send · Shift + Enter for a new line'), this.error,
    );
    this.element = el('aside', { class: 'room-chat panel', 'aria-labelledby': 'chat-title' },
      el('div', { class: 'chat-heading' }, el('div', {}, el('p', { class: 'eyebrow' }, 'AT THE TABLE'), el('h2', { id: 'chat-title' }, 'Room chat')), el('span', { class: 'chat-live' }, 'FRIENDS ONLY')),
      el('div', { class: 'chat-log-wrap' }, this.empty, this.log), this.newMessages, this.form,
    );
    this.form.addEventListener('submit', event => { event.preventDefault(); this.submit(); });
    this.input.addEventListener('input', () => this.updateControls());
    this.input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        this.form.requestSubmit();
      }
    });
    this.newMessages.addEventListener('click', () => this.scrollToLatest());
    this.log.addEventListener('scroll', () => { if (this.atBottom()) this.clearUnread(); }, { passive: true });
  }

  atBottom() { return this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 48; }
  clearUnread() { this.unread = 0; this.newMessages.hidden = true; }
  scrollToLatest() { this.log.scrollTop = this.log.scrollHeight; this.clearUnread(); }
  setConnected(connected, playerId) { this.connected = connected; this.playerId = playerId; this.updateControls(); }
  updateControls() {
    this.input.disabled = !this.connected;
    this.input.readOnly = Boolean(this.pending);
    this.sendButton.disabled = !this.connected || Boolean(this.pending) || !this.input.value.trim();
    this.sendButton.firstChild.textContent = this.pending ? 'SENDING…' : 'SEND';
    this.count.textContent = `${this.input.value.length} / ${CHAT_LIMITS.length}`;
  }
  reset() {
    clearTimeout(this.timer);
    this.pending = null;
    this.revision = -1;
    this.playerId = null;
    this.connected = false;
    this.log.replaceChildren();
    this.input.value = '';
    this.empty.hidden = false;
    this.error.hidden = true;
    this.clearUnread();
    this.updateControls();
  }
  submit() {
    if (!this.connected || this.pending) return;
    let text;
    try { text = normalizeChatText(this.input.value); }
    catch (error) { this.fail(error.message); return; }
    this.error.hidden = true;
    this.pending = randomToken(20);
    this.updateControls();
    this.timer = setTimeout(() => this.fail('Still waiting for the host. Check your connection before trying again.', this.pending), 12000);
    this.onSend(text, this.pending);
  }
  fail(text, requestId) {
    if (requestId && requestId !== this.pending) return;
    clearTimeout(this.timer);
    this.pending = null;
    this.error.textContent = text;
    this.error.hidden = false;
    this.updateControls();
  }
  update(snapshot, acceptedRequestId) {
    if (snapshot.revision <= this.revision) return;
    const ownAccepted = this.pending && this.pending === acceptedRequestId;
    const pinned = this.atBottom() || ownAccepted;
    this.revision = snapshot.revision;
    const ids = new Set(snapshot.messages.map(entry => String(entry.id)));
    for (const node of [...this.log.children]) if (!ids.has(node.dataset.messageId)) node.remove();
    const seen = new Set([...this.log.children].map(node => node.dataset.messageId));
    let added = 0;
    for (const entry of snapshot.messages) {
      if (seen.has(String(entry.id))) continue;
      added++;
      const own = entry.playerId === this.playerId;
      const time = new Date(entry.timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
      // Only text nodes: never HTML parsing, Markdown, linkification or event attributes.
      this.log.append(el('li', { class: `chat-message${own ? ' own-message' : ''}`, 'data-message-id': entry.id },
        el('div', { class: 'chat-message-heading' }, el('strong', {}, entry.name, own ? el('small', {}, ' YOU') : null),
          el('time', { datetime: new Date(entry.timestamp).toISOString() }, time)),
        el('p', { class: 'chat-text' }, entry.text),
      ));
    }
    this.empty.hidden = snapshot.messages.length > 0;
    if (ownAccepted) {
      clearTimeout(this.timer);
      this.pending = null;
      this.input.value = '';
      this.error.hidden = true;
      this.updateControls();
    }
    if (pinned) this.scrollToLatest();
    else if (added) {
      this.unread += added;
      this.newMessages.textContent = `${this.unread} new ${this.unread === 1 ? 'message' : 'messages'} ↓`;
      this.newMessages.hidden = false;
    }
  }
}
