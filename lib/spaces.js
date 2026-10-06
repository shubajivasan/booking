import { AAPA_SEATS_PER_PARTITION } from './schedule';

// The spaces shown as cards on the public booking page, with their default
// details. A super admin can change the name, badge, type, seats, price and
// description of any of them in the admin dashboard (Spaces tab); those edits
// are stored in the space_details table and laid over these defaults by
// mergeSpaceDetails(). A space nobody has edited shows exactly what is here.
export const SPACE_CARDS = [
  { id: 'R1', name: 'Room No 1', type: 'Practice room', code: '01', capacity: 12, price: 300, desc: 'Practice room set up for individual and small-group sessions.' },
  { id: 'R2', name: 'Room No 2', type: 'Practice room', code: '02', capacity: 12, price: 300, desc: 'Practice room set up for individual and small-group sessions.' },
  { id: 'R3', name: 'Room No 3', type: 'Practice room', code: '03', capacity: 12, price: 300, desc: 'Practice room set up for individual and small-group sessions.' },
  { id: 'R4', name: 'Room No 4', type: 'Practice room', code: '04', capacity: 12, price: 300, desc: 'Practice room set up for individual and small-group sessions.' },
  { id: 'R5', name: 'Room No 5', type: 'Practice room', code: '05', capacity: 15, price: 350, desc: 'Practice room with extra floor space for small-group classes.' },
  { id: 'R6', name: 'Room No 6', type: 'Practice room', code: '06', capacity: 15, price: 350, desc: 'Practice room with extra floor space for small-group classes.' },
  { id: 'R7', name: 'Room No 7', type: 'Practice room', code: '07', capacity: 15, price: 350, desc: 'Practice room with extra floor space for small-group classes.' },
  { id: 'R8', name: 'Room No 8', type: 'Practice room', code: '08', capacity: 18, price: 400, desc: 'Larger practice room, suited to group classes and rehearsal.' },
  { id: 'R9', name: 'Room No 9', type: 'Practice room', code: '09', capacity: 18, price: 400, desc: 'Larger practice room, suited to group classes and rehearsal.' },
  { id: 'R10', name: 'Room No 10', type: 'Practice room', code: '10', capacity: 18, price: 400, desc: 'Larger practice room, suited to group classes and rehearsal.' },
  { id: 'BH', name: 'Studio D', type: 'Recording Studio', code: 'SD', capacity: 10, price: 1200, desc: 'Recording studio for up to 10 people.' },
  { id: 'GTR', name: 'Guitar Room', type: 'Instrument room', code: 'GTR', capacity: 8, price: 350, desc: 'Dedicated room fitted out for guitar lessons and practice, with amps and stands on hand.' },
  { id: 'KEY', name: 'Keyboard Room', type: 'Instrument room', code: 'KEY', capacity: 8, price: 350, desc: 'Fitted with keyboards and a piano bench setup for individual and paired keyboard lessons.' },
  { id: 'DRM', name: 'Drum Room', type: 'Instrument room · soundproofed', code: 'DRM', capacity: 6, price: 400, desc: 'Soundproofed room with a full drum kit, built for drum lessons and practice sessions.' },
  { id: 'MLB', name: 'Music Lab Room', type: 'Recording and production lab', code: 'MLB', capacity: 10, price: 500, desc: 'Recording and production lab with audio workstations, used for production classes and studio sessions.' },
  // One card for the whole hall; on its page the student picks partitions.
  // price 0 = not set yet (bookings are by request; the academy confirms the cost).
  { id: 'AAPA', name: 'AAPA Hall', type: 'Hall \u00b7 4 partitions', code: 'AAPA', capacity: 4 * AAPA_SEATS_PER_PARTITION, price: 0, partitioned: true, desc: 'A large hall that divides into 4 partitions. Book one partition, several together, or the whole hall.' },
];

export const SPACE_IDS = SPACE_CARDS.map(s => s.id);

// rows: space_details rows { id, name, code, type, capacity, price_per_hour, description }.
// Empty or missing fields keep the default.
export function mergeSpaceDetails(rows) {
  const byId = Object.fromEntries((rows || []).map(r => [r.id, r]));
  return SPACE_CARDS.map(card => {
    const r = byId[card.id];
    if (!r) return card;
    const text = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
    return {
      ...card,
      name: text(r.name) ?? card.name,
      code: text(r.code) ?? card.code,
      type: text(r.type) ?? card.type,
      capacity: num(r.capacity) ?? card.capacity,
      price: num(r.price_per_hour) ?? card.price,
      desc: text(r.description) ?? card.desc,
    };
  });
}
