import { describe, it, expect, vi, afterEach } from 'vitest';
import { mxDateParts, insertInteraction } from '../interactions';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mxDateParts (America/Mexico_City)', () => {
  it('19:30 de México (01:30Z del día siguiente)', () => {
    expect(mxDateParts(new Date('2026-11-06T01:30:00Z'))).toEqual({
      date: '2026-11-05',
      time: '19:30',
      range: '19:00 - 20:00',
    });
  });
  it('última hora del día → 23:00 - 00:00', () => {
    expect(mxDateParts(new Date('2026-11-06T05:45:00Z'))).toEqual({
      date: '2026-11-05',
      time: '23:45',
      range: '23:00 - 00:00',
    });
  });
  it('medianoche de México → nuevo día 00:00', () => {
    expect(mxDateParts(new Date('2026-11-06T06:00:00Z'))).toEqual({
      date: '2026-11-06',
      time: '00:00',
      range: '00:00 - 01:00',
    });
  });
  it('no depende de process.env.TZ', () => {
    const prev = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      expect(mxDateParts(new Date('2026-11-06T01:30:00Z')).date).toBe('2026-11-05');
      expect(mxDateParts(new Date('2026-11-06T01:30:00Z')).time).toBe('19:30');
    } finally {
      process.env.TZ = prev;
    }
  });
});

describe('insertInteraction', () => {
  it('envía contact_date/contact_time/range_time de México', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await insertInteraction({
      creditId: 'c1',
      campaign: 'bancoppel',
      phone10: '5512345678',
      contactable: true,
      subdictamen: 'Se envía WhatsApp',
      comments: '',
      at: new Date('2026-11-06T01:30:00Z'),
    });
    const body = JSON.parse(String(f.mock.calls[0][1]?.body));
    expect(body.interactions[0]).toMatchObject({
      contact_date: '2026-11-05',
      contact_time: '19:30',
      range_time: '19:00 - 20:00',
    });
  });
});
