import { describe, expect, it } from 'vitest';
import { DEFAULT_SLA, slaTargetsFor, ticketEmail } from '../src/modules/helpdesk/helpdesk.util';

describe('helpdesk.util SLA targets', () => {
  it('uses the built-in default for a priority when no policy is configured', () => {
    expect(slaTargetsFor('URGENT')).toEqual(DEFAULT_SLA.URGENT);
    expect(slaTargetsFor('LOW', null)).toEqual(DEFAULT_SLA.LOW);
    // urgent has the tightest targets, low the loosest
    expect(DEFAULT_SLA.URGENT.resolutionMins).toBeLessThan(DEFAULT_SLA.LOW.resolutionMins);
  });

  it('a tenant policy overrides the default', () => {
    expect(slaTargetsFor('HIGH', { firstResponseMins: 15, resolutionMins: 120 })).toEqual({ firstResponseMins: 15, resolutionMins: 120 });
  });
});

describe('helpdesk.util customer emails', () => {
  const info = { ticketNo: 'TKT-000001', subject: 'Login fails', requesterName: 'Dana Scully', link: 'https://store/shop/acme/account/support/TKT-000001', storeName: 'Acme' };

  it('builds distinct emails per ticket event, all referencing the ticket + link', () => {
    const created = ticketEmail('created', info);
    expect(created.subject).toBe('[TKT-000001] We’ve received your request');
    expect(created.text).toContain('Login fails');
    expect(created.text).toContain(info.link);
    expect(ticketEmail('replied', info).subject).toContain('New reply');
    expect(ticketEmail('resolved', info).subject).toContain('resolved');
    expect(ticketEmail('resolved', info).text).toContain('rating');
  });

  it('omits the link line when no portal URL is configured', () => {
    const m = ticketEmail('created', { ...info, link: null });
    expect(m.text).not.toContain('View the conversation');
  });
});
