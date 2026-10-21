# Legal checklist for operators

**This is practical guidance, not legal advice.** The software cannot decide whether a track infringes copyright, imitates a real person's voice, or really is AI-generated. If you serve the public, those decisions are yours, and the rules differ by country. Use this page to prepare, then ask a lawyer where you operate.

## If you have no lawyer

Most small hobby and community projects start without one. This is the order I would work in, from cheapest and most protective to most formal. Nothing here replaces advice for your situation.

1. **Keep it small and controlled first.** An instance that is invite-only (`REGISTRATION=invite`) with `REQUIRE_APPROVAL=true`, where you know the uploaders, has a very different risk profile from an open public site. Run it that way for a while and loosen it only when you are comfortable with how reports are handled.
2. **Fill in the basics the software supports.** Set `CONTACT_EMAIL` and `LEGAL_URL`, publish a short terms page (template below), and answer every report quickly. Acting promptly on a credible notice is the single habit that matters most under notice-and-action rules such as the EU Digital Services Act and the US DMCA.
3. **Always tell the uploader why.** When you remove a track, the dialog asks for a reason, and the uploader sees it in their Library (the EU rules ask for a clear statement of reasons when content is removed). Write the rule that was broken or the claim you received, not just "removed".
4. **Keep a record.** Reports, resolutions and reasons are stored; export them (or the database) now and then.
5. **Check the official texts for the few rules that apply to you.** As far as I could verify from a secondary summary (not the regulation itself), the DSA obligations that apply even to very small hosting services are: a contact point for authorities and users (Arts. 11-12), terms that describe your moderation (Art. 14), a notice mechanism and diligent handling of notices (Art. 16), and a statement of reasons to the affected user (Art. 17). The regulation is public on EUR-Lex (Regulation (EU) 2022/2065); read those articles once. Whether transparency reports are required for a micro enterprise, and whether you count as one, is exactly the kind of question to confirm with an authoritative source.
6. **Cheap sources of real advice.** National bar associations and many university law clinics offer a free or low-cost first consultation, and a single hour with a lawyer who knows IT or copyright law is usually enough to review your terms page and your takedown routine. Prepare with the questions below so the hour is not wasted.
7. **Know what you are not covered for.** If a rights holder sends a formal claim, or a regulator contacts you, stop improvising and get advice at that point; do not ignore it.

## What the software already does

| Risk | Built-in help |
|---|---|
| Uploader claims rights they do not have | Every upload requires the "AI-generated, I have the right to publish" confirmation and a prompt/description; the license field states what listeners may do |
| Infringing or abusive track | Public "Report" button (no account needed, optional contact details); moderator queue; one-click removal; removed tracks stay hidden but are kept until you delete them, so you can review or restore |
| Telling the uploader why | Removing a track requires a written reason, which the uploader sees in their Library |
| Repeat offenders | Admins can disable accounts (this also ends their sessions) |
| Unreviewed content | `REQUIRE_APPROVAL=true` holds every upload until a moderator publishes it; `REGISTRATION=invite` or `closed` limits who can upload |
| Contact for rights holders | `CONTACT_EMAIL` and `LEGAL_URL` appear on the About page |
| Personal data | No email, no analytics, no third-party requests; users can export and delete their data |

## Before you open a public instance

1. Set `CONTACT_EMAIL` to a mailbox someone reads, and `LEGAL_URL` to your own terms and privacy page (a starting point is below).
2. Start with `REQUIRE_APPROVAL=true` or invite-only registration.
3. Decide who the moderators are and how fast you will act on a report. Write the target down (for example "within 48 hours") and keep to it.
4. Find out whether your country requires registering a contact point or agent for takedown notices (for example under the US DMCA, designating an agent is what preserves the safe harbor there; the EU Digital Services Act has notice-and-action and transparency duties whose scope depends on your size). A lawyer can tell you which apply.
5. Keep a simple log: date a report arrived, what you decided, date you acted. The report table already stores reports and resolutions; export it before deleting old data.
6. Back up `DATA_DIR` ([DEPLOY.md](DEPLOY.md)) and write down who may restore it.

## Handling a takedown notice

1. A notice arrives through the Report button or `CONTACT_EMAIL`. Check it names the track (a link such as `/t/<id>`), the rights holder, and the claim.
2. Open the report in **Admin → Reports**. If the claim is plausible, choose **Remove track** and write the reason; the track disappears from every page and from search at once.
3. The uploader sees your reason under **Library → Uploads → Removed by moderators**. The software has no email, so the notifier (if they left contact details) must be answered by you by hand.
4. If the uploader disputes it, decide according to your terms and local law. Keep both messages.
5. Accounts with repeated valid notices: disable them in **Admin → Users**.

## Questions to ask a lawyer

- Which hosting-provider safe-harbor or notice-and-action rules apply to me, and what must I register or publish?
- Does my instance count as a "service provider" with transparency or reporting duties at my size?
- Which terms of service should I require from uploaders about the AI generator they used (many generators restrict free-tier or non-commercial output)?
- What is my exposure for tracks that imitate a real artist's voice, and what takedown rule should I adopt for them?
- Do I need a privacy notice or a data-processing description, given I store usernames, password hashes and user content?
- If I let people send donations or sell access, what changes?
- Do I need to keep removed content for a period, and for how long should I keep reports?

## Starting point for your terms page (edit before use)

> **Terms of use (draft template)**
> *[Operator name and contact: …]*
>
> 1. **What this service is.** A place to share music that was generated with AI tools.
> 2. **Your content.** You may upload only tracks that were generated with AI tools, for which you have the right to publish them under the terms of the generator you used and applicable law. You must not upload other people's recordings, tracks that imitate a real person's voice without their consent, or illegal or abusive content.
> 3. **Licenses.** The license shown on a track is the uploader's statement of what listeners may do. Listening here does not transfer rights.
> 4. **Reports and removal.** Anyone may report a track. We remove content that appears to break these terms or the law, and we may disable accounts of repeat offenders. Rights holders can write to *[CONTACT_EMAIL]*.
> 5. **Your data.** We store your username, a password hash, and what you create. You can export or delete it in Settings.
> 6. **No warranty.** The service is provided as is. *[Add the liability and governing-law clauses your lawyer recommends.]*

Publish this at the URL you put in `LEGAL_URL`.
