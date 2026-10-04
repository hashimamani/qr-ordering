/**
 * Public privacy notice.
 *
 * Exists for two reasons: Meta requires a reachable Privacy Policy URL
 * before an app can be switched to Live, and customers hand over a phone
 * number at order time with no other account or terms to read.
 *
 * Everything below describes what the code actually does. Where the
 * honest answer is "we have not built that yet" -- retention is the one
 * that matters -- it says so rather than stating a policy no job
 * enforces. Keep it that way: a notice that drifts from the behaviour is
 * worse than none.
 */

// Meta (and the Kenyan Data Protection Act) expect a working route to a
// human. Verify this address still receives mail before relying on it:
// a published policy pointing at a dead mailbox is worse than useless,
// since someone exercising a data request gets silence.
const CONTACT_EMAIL = 'admin@amanilabs.co.ke';

const LAST_UPDATED = '4 October 2026';

export function PrivacyPage() {
  return (
    <main>
      <h1 className="policy-title">Privacy Policy</h1>
      <p className="policy-meta">Last updated {LAST_UPDATED}</p>

      <div className="card policy">
        <h2>Who this covers</h2>
        <p>
          Tab is ordering software used by restaurants. When you scan a QR code at a table, you are
          ordering from that restaurant; Tab provides and runs the system that takes the order and
          sends you updates about it. Both the restaurant and Tab can see the information below.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>A phone number or email address</strong>, which you type in yourself when
            placing an order, together with the channel you chose to receive messages on (WhatsApp,
            SMS or email) and the time you gave it.
          </li>
          <li>
            <strong>Your order</strong> — the items, quantities, any notes you add, the table you
            ordered from, and the total.
          </li>
          <li>
            <strong>Delivery records</strong> for the messages we send you: whether each one was
            accepted, delivered, read or failed, and the message reference our provider gives us.
            This is how we find out when a message never reached you.
          </li>
        </ul>

        <h2>What we do not collect</h2>
        <p>
          <strong>No payment details.</strong> Tab does not process payments and never sees a card
          number, bank detail or mobile-money PIN. Paying happens between you and the restaurant;
          a member of staff marks the order as paid afterwards. We hold no more than that flag.
        </p>
        <p>
          We do not ask for your name, we do not use cookies to track you across other websites,
          and we do not build a profile of you between visits.
        </p>

        <h2>What we use it for</h2>
        <p>
          Only to handle the order you placed: confirming we received it, telling you when it is
          ready, and sending your receipt. We do not send marketing, and we do not sell or rent your
          details to anyone.
        </p>

        <h2>Who else sees it</h2>
        <p>
          To deliver a message we have to hand your phone number or email to the service carrying
          it — Meta (WhatsApp), Africa&apos;s Talking (SMS) or Amazon Web Services (email). They
          receive only what is needed to deliver that message. The system itself runs on Amazon Web
          Services in Ireland, so your order information is stored there.
        </p>

        <h2>Receipts</h2>
        <p>
          A receipt link works for 24 hours and then stops working. Opening it also asks for the
          last four digits of the number the receipt was sent to, so someone who comes across the
          link cannot read your receipt without it.
        </p>

        <h2>How long we keep it</h2>
        <p>
          Orders and the contact details attached to them are kept indefinitely at present — we have
          not set an automatic deletion schedule, and we would rather say so than claim one we do
          not yet enforce. If you want your details removed, ask us and we will delete them.
        </p>

        <h2>Your rights</h2>
        <p>
          Under the Kenyan Data Protection Act, 2019 you can ask what we hold about you, ask us to
          correct it, or ask us to delete it. Write to us and we will act on it.
        </p>

        <h2>Contact</h2>
        <p>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </div>
    </main>
  );
}
