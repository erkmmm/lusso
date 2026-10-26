/**
 * The one way a quote goes to a customer.
 *
 * Three screens can send a quote — the Quotes list, the quote detail page and
 * the builder's Save & Send — and each used to do its own thing. The list
 * marked quotes Sent without emailing anything at all, and the builder marked
 * them Sent before the email was attempted. Both left quotes sitting in
 * "Out — awaiting customer", counting down to expiry, that no customer had
 * ever received.
 *
 * So the order is the point of this module, and it is not negotiable:
 *
 *   1. check the customer can actually be emailed,
 *   2. send the email and wait for the provider to accept it,
 *   3. only then mark the quote Sent.
 *
 * Step 3 starts the expiry countdown and moves the quote out of Draft, so it
 * must never run for a quote that didn't go out. Anything that goes wrong
 * throws with a message that can be shown to the user as-is.
 */

import {
  getQuote, getCustomer, sendQuote, getMessagePresets, addActivity,
  recordQuoteFollowUp,
} from '../store/data';
import { sendQuoteEmail } from './email';

/**
 * Email a quote to its customer, then mark it Sent.
 *
 * @param {object|string} quoteOrId - the quote, or its id
 * @param {object}  [opts]
 * @param {string}  [opts.user]        - who is sending, for the audit trail
 * @param {boolean} [opts.logActivity] - also write a job activity entry
 * @returns {Promise<{quote: object, customer: object, unconfirmed?: boolean}>}
 * @throws {Error} with a user-facing message if the quote can't be sent
 */
export async function deliverQuote(quoteOrId, { user = 'Admin', logActivity = false } = {}) {
  const quote = typeof quoteOrId === 'string' ? getQuote(quoteOrId) : quoteOrId;
  if (!quote) throw new Error('Quote not found.');

  const customer = getCustomer(quote.customerId);
  if (!customer?.email) {
    throw new Error(
      `${customer?.name || 'This customer'} has no email address on file. ` +
      'Add one to the customer record, then send the quote.'
    );
  }

  // Throws on any provider failure — which is what keeps step 3 from running.
  const result = await sendQuoteEmail(quote, customer, getMessagePresets().quoteEmailIntro);

  sendQuote(quote.id, user);

  if (logActivity && quote.jobId) {
    addActivity({
      jobId: quote.jobId,
      type: 'quote_sent',
      message: `Quote ${quote.quoteNumber} sent to ${customer.email}`,
      user,
    });
  }

  // `unconfirmed` means the mail service answered 2xx but not in a way that
  // confirms a send (see lib/email.js). The quote is marked Sent because the
  // request did go through, but the caller should say so rather than promise
  // the customer has it.
  return { quote: getQuote(quote.id) || quote, customer, unconfirmed: !!result?.unconfirmed };
}

/**
 * Chase a quote the customer hasn't answered: the same quote, sent again.
 *
 * Follows the same order as deliverQuote and for the same reason — email
 * first, record second, so nothing is marked chased that didn't go out.
 *
 * What it deliberately does NOT do is call sendQuote(). That would set the
 * status back to 'Sent', throwing away the fact that the customer had opened
 * it, and it is the function that anchors the expiry. A follow-up moves no
 * deadline and changes nothing about where the customer's decision stands.
 *
 * @param {object|string} quoteOrId
 * @param {object}  [opts]
 * @param {string}  [opts.user]
 * @returns {Promise<{quote: object, customer: object, unconfirmed?: boolean}>}
 * @throws {Error} with a user-facing message
 */
export async function deliverQuoteFollowUp(quoteOrId, { user = 'Admin' } = {}) {
  const quote = typeof quoteOrId === 'string' ? getQuote(quoteOrId) : quoteOrId;
  if (!quote) throw new Error('Quote not found.');

  // Only a quote that actually went out can be followed up — chasing a draft
  // would send the customer their first sight of it under a "following up"
  // subject line.
  if (!quote.sentAt) {
    throw new Error(`Quote ${quote.quoteNumber || ''} hasn't been sent yet, so there's nothing to follow up.`.trim());
  }

  const customer = getCustomer(quote.customerId);
  if (!customer?.email) {
    throw new Error(
      `${customer?.name || 'This customer'} has no email address on file. ` +
      'Add one to the customer record, then send the follow-up.'
    );
  }

  const result = await sendQuoteEmail(
    quote, customer, getMessagePresets().quoteFollowUpIntro, { followUp: true },
  );

  recordQuoteFollowUp(quote.id, user);

  if (quote.jobId) {
    addActivity({
      jobId: quote.jobId,
      type: 'quote_followed_up',
      message: `Follow-up on quote ${quote.quoteNumber} sent to ${customer.email}`,
      user,
    });
  }

  return { quote: getQuote(quote.id) || quote, customer, unconfirmed: !!result?.unconfirmed };
}
