import type { Metadata } from "next";

export const metadata: Metadata = { title: "End User License Agreement · GrantBridge" };

export default function TermsPage() {
  return (
    <article className="space-y-6 text-[17px] leading-relaxed">
      <header>
        <p className="text-xs tracking-[0.14em] uppercase text-accent font-mono">GrantBridge</p>
        <h1 className="text-3xl font-semibold text-navy mt-1">End User License Agreement</h1>
        <p className="text-muted text-sm mt-2">Effective November 10, 2026</p>
      </header>

      <p>
        GrantBridge (the &ldquo;Application&rdquo;) is an internal grant-accounting tool owned and operated by the
        Institute for Leadership Education Advancement, Inc. (&ldquo;I-LEAD&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;),
        a Pennsylvania nonprofit corporation, 1122 County Line Rd, Bryn Mawr, PA 19010. This agreement governs use of
        the Application by the people I-LEAD authorizes to use it.
      </p>

      <Section title="1. Who may use the Application">
        <p>
          The Application is available only to I-LEAD staff, contractors and advisors whom an I-LEAD administrator has
          invited by email address. It is not offered to the public, and no one else may create an account or use it.
          By signing in you confirm that you are an authorized user acting on I-LEAD&rsquo;s behalf.
        </p>
      </Section>

      <Section title="2. What the Application does">
        <p>
          The Application reads accounting data from I-LEAD&rsquo;s QuickBooks Online company through Intuit&rsquo;s
          authorized API in order to track grant budgets, classify expenditures to grants, allocate payroll to grants,
          and prepare reports and reimbursement requests for grant funders. It does not create, modify or delete any
          record in QuickBooks Online.
        </p>
      </Section>

      <Section title="3. License">
        <p>
          I-LEAD grants each authorized user a limited, revocable, non-transferable right to use the Application for
          I-LEAD&rsquo;s grant administration. You may not copy, sell, sublicense, reverse engineer or make the
          Application available to anyone outside I-LEAD, and you may not use it for any purpose other than I-LEAD&rsquo;s
          business.
        </p>
      </Section>

      <Section title="4. Your responsibilities">
        <ul className="list-disc pl-6 space-y-1">
          <li>Keep your sign-in email account secure; sign-in links sent to it act as your password.</li>
          <li>Use the Application only within the role an administrator has assigned to you.</li>
          <li>Review and approve classifications, allocations and reports with care: the Application prepares drafts and suggestions, and approvals are your decisions.</li>
          <li>Follow I-LEAD&rsquo;s policies and the terms of each grant when using information from the Application.</li>
        </ul>
      </Section>

      <Section title="5. Third-party services">
        <p>
          The Application relies on Intuit QuickBooks Online (accounting data), Supabase (database, authentication and
          file storage), Vercel (hosting) and Anthropic (AI assistance in reading documents and drafting). Your use of
          QuickBooks Online remains subject to Intuit&rsquo;s own terms of service. The Application&rsquo;s connection
          to QuickBooks can be revoked at any time by an I-LEAD administrator from within the Application or from the
          QuickBooks &ldquo;Apps&rdquo; settings.
        </p>
      </Section>

      <Section title="6. Ownership">
        <p>
          The Application, its code and its design are I-LEAD&rsquo;s property. Accounting data remains I-LEAD&rsquo;s
          data. Nothing in this agreement transfers any intellectual-property rights.
        </p>
      </Section>

      <Section title="7. No warranty; limitation of liability">
        <p>
          The Application is provided &ldquo;as is&rdquo; for internal use. I-LEAD makes no warranty that it is error-free
          or uninterrupted. Figures it produces are for I-LEAD&rsquo;s internal preparation of funder submissions and
          are subject to human review before submission. To the fullest extent permitted by law, I-LEAD is not liable
          to any user for indirect or consequential damages arising from use of the Application.
        </p>
      </Section>

      <Section title="8. Termination">
        <p>
          I-LEAD may suspend or remove any user&rsquo;s access at any time. Access ends automatically when a person is
          no longer authorized to act for I-LEAD. Sections 3, 6 and 7 survive termination.
        </p>
      </Section>

      <Section title="9. Changes and governing law">
        <p>
          I-LEAD may update this agreement by posting a revised version at this address with a new effective date.
          This agreement is governed by the laws of the Commonwealth of Pennsylvania.
        </p>
      </Section>

      <Section title="10. Contact">
        <p>
          Questions about this agreement: I-LEAD, Inc., 1122 County Line Rd, Bryn Mawr, PA 19010 ·{" "}
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
