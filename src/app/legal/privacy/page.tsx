import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy · GrantBridge" };

export default function PrivacyPage() {
  return (
    <article className="space-y-6 text-[17px] leading-relaxed">
      <header>
        <p className="text-xs tracking-[0.14em] uppercase text-accent font-mono">GrantBridge</p>
        <h1 className="text-3xl font-semibold text-navy mt-1">Privacy Policy</h1>
        <p className="text-muted text-sm mt-2">Effective November 10, 2026</p>
      </header>

      <p>
        This policy describes what information GrantBridge (the &ldquo;Application&rdquo;) collects, how it is used,
        where it is stored and who can see it. The Application is an internal tool operated by the Institute for
        Leadership Education Advancement, Inc. (&ldquo;I-LEAD&rdquo;), 1122 County Line Rd, Bryn Mawr, PA 19010, for
        its own grant administration. It is used only by people I-LEAD authorizes; it is not a consumer service.
      </p>

      <Section title="1. Information the Application collects">
        <p><strong>From QuickBooks Online.</strong> With the authorization of an I-LEAD administrator, the Application
        connects to I-LEAD&rsquo;s QuickBooks Online company through Intuit&rsquo;s API and reads: the chart of accounts,
        classes, vendor and employee names, and expenditure transactions (expenses, checks, bills, vendor credits and
        journal entries) including dates, amounts, accounts, memos and payee names. The Application reads this data; it
        never writes to QuickBooks Online. Intuit access and refresh tokens are stored encrypted.</p>
        <p className="mt-2"><strong>Documents you upload.</strong> Grant agreements, applications, approved budgets, funder
        instructions and templates, and payroll reports. Payroll reports contain employee names and pay amounts.</p>
        <p className="mt-2"><strong>About users.</strong> Your email address, your assigned role, and a record of the
        actions you take in the Application (for example approving a classification or a report), with timestamps.</p>
        <p className="mt-2"><strong>Technical.</strong> Standard server logs kept by our hosting provider (IP address,
        browser type, request time). The Application does not use advertising or analytics trackers.</p>
      </Section>

      <Section title="2. How the information is used">
        <p>
          Solely to administer I-LEAD&rsquo;s grants: tracking budgets, classifying expenditures to grants, allocating
          payroll to grants, reconciling to the general ledger, and preparing reports and reimbursement requests for
          funders. Portions of uploaded documents and transaction descriptions are sent to Anthropic&rsquo;s Claude API
          to extract structured data and draft suggestions; every such call is logged. Anthropic&rsquo;s API terms do not
          permit use of that content to train its models.
        </p>
      </Section>

      <Section title="3. Where the information is stored">
        <p>
          In a Supabase database and file store in the United States (us-east-1), with access controlled by role; on
          Vercel, which hosts the Application; and, for AI processing, transiently with Anthropic. QuickBooks data also
          remains in Intuit&rsquo;s systems under Intuit&rsquo;s own privacy policy.
        </p>
      </Section>

      <Section title="4. Who can see it">
        <p>
          Authorized I-LEAD users according to their role (administrator, bookkeeper or viewer); the service providers
          named above, as needed to operate the Application; I-LEAD&rsquo;s auditors and grant funders, to the extent
          I-LEAD shares reports with them. The Application does not sell, rent or share information for marketing, and
          does not share QuickBooks data with any third party except the service providers listed here.
        </p>
      </Section>

      <Section title="5. Security">
        <p>
          Sign-in is by invitation only, using one-time links sent to a verified email address. Intuit tokens are
          encrypted at rest with a key held only by the Application&rsquo;s server. Database access is enforced row by row
          according to the user&rsquo;s role. Connections use TLS. Only server-side code with elevated credentials can
          read the QuickBooks connection record.
        </p>
      </Section>

      <Section title="6. Retention">
        <p>
          Grant records, classified transactions, allocations and submitted reports are retained for as long as the
          grant&rsquo;s record-retention requirements demand — typically several years after a grant closes, as set by
          the funder and by law — because they are I-LEAD&rsquo;s accounting records. User accounts are removed when a
          person leaves I-LEAD. Disconnecting QuickBooks deletes the stored tokens immediately.
        </p>
      </Section>

      <Section title="7. Your choices">
        <p>
          An I-LEAD administrator can disconnect the Application from QuickBooks Online at any time, from the
          Application&rsquo;s QuickBooks settings or from the &ldquo;Apps&rdquo; area of QuickBooks Online, which revokes
          its access. Users may ask an administrator to correct or remove their account information.
        </p>
      </Section>

      <Section title="8. Changes">
        <p>I-LEAD may update this policy by posting a revised version at this address with a new effective date.</p>
      </Section>

      <Section title="9. Contact">
        <p>
          Privacy questions: I-LEAD, Inc., 1122 County Line Rd, Bryn Mawr, PA 19010 ·{" "}
          <a href="mailto:dc@i-leadusa.org" className="text-navy underline">dc@i-leadusa.org</a>
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-navy mb-2">{title}</h2>
      {children}
    </section>
  );
}
