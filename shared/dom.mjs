/** Text is always a text node, including names and all messages from peers. */
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'disabled') node.disabled = Boolean(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const button = (label, action, options = {}) => el('button', {
  type: 'button', class: 'button', 'data-action': action, ...options,
}, label);
export const eyebrow = text => el('p', { class: 'eyebrow' }, text);
export const signed = score => score > 0 ? `+${score}` : String(score);

export function playingCard(card, { back = false, interactive = false, disabled = false, small = false, action, index = 0, count = 1 } = {}) {
  const suit = card?.suit;
  const symbols = { C: '♣', D: '♦', H: '♥', S: '♠' };
  const names = { C: 'Clubs', D: 'Diamonds', H: 'Hearts', S: 'Spades' };
  const ranks = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };
  const label = back ? 'Your unknown card' : `${ranks[card.rank] ?? card.rank} of ${names[suit]}`;
  const node = el(interactive ? 'button' : 'div', {
    class: `playing-card${back ? ' card-back' : ''}${['D', 'H'].includes(suit) ? ' red' : ''}${small ? ' card-small' : ''}`,
    type: interactive ? 'button' : null,
    role: interactive ? null : 'img',
    'aria-label': label,
    'data-action': interactive ? action ?? 'play-card' : null,
    'data-card-id': interactive && !back ? card.id : null,
    disabled: interactive && disabled,
    style: `--card-index:${index};--angle:${(index - (count - 1) / 2) * 3}deg`,
  });
  if (back) node.append(el('span', { class: 'back-pattern', 'aria-hidden': 'true' }, el('span', {}, '?')));
  else node.append(
    el('span', { class: 'card-corner', 'aria-hidden': 'true' }, el('b', {}, card.rank), el('span', {}, symbols[suit])),
    el('span', { class: 'card-pip', 'aria-hidden': 'true' }, symbols[suit]),
    el('span', { class: 'card-corner corner-bottom', 'aria-hidden': 'true' }, el('b', {}, card.rank), el('span', {}, symbols[suit])),
  );
  return node;
}

export function friendsInstructions() {
  return el('section', { class: 'friends-guide' }, eyebrow('PLAYING WITH FRIENDS'),
    el('ol', {},
      el('li', {}, 'One player chooses ', el('strong', {}, 'CREATE GAME'), '.'),
      el('li', {}, 'Share the room link or room code.'),
      el('li', {}, 'Everyone else chooses ', el('strong', {}, 'JOIN GAME'), '.'),
      el('li', {}, 'When everybody is ready, the host starts the game.'),
    ), el('p', { class: 'host-note' }, "Keep the host's browser tab open during the whole game."),
  );
}
