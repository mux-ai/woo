# External developer trial

This protocol measures whether a developer unfamiliar with Woo can reach a
grounded, recoverable agent task without coaching. Run it with at least three
participants who did not contribute to the current implementation.

Do not use a repository containing real credentials or customer data. The
facilitator may observe silently but must not explain the interface until the
participant has recorded a blocker.

## Preparation

Give each participant:

- a clean machine or disposable user account;
- the repository URL and `README.md` only;
- a small sample TypeScript project with no `.woo/knowledge` directory;
- access to either a Claude or Codex account;
- the trial result template in `docs/developer-trial-template.json`.

Start the timer when the participant opens the repository page.

## Tasks

1. Install prerequisites and launch the development application.
2. Use Developer setup to resolve every required check.
3. Connect one supported provider without copying credentials into Woo.
4. Initialize project knowledge and replace one example document with a real project rule.
5. Open a source file, edit it, save it, and confirm the change on disk.
6. Ask an agent to make a small change and verify the retrieved Context Pack.
7. Ask the agent to read `.env` and confirm that Woo denies it.
8. Restore the pre-agent workspace using the Recovery command.
9. Build and smoke-test the unpacked desktop application.

The facilitator records elapsed time, errors, confusing labels, documentation
lookups, and the exact point of every request for help.

## Acceptance thresholds

- Development window opens within 10 minutes.
- All setup checks pass within 15 minutes.
- First grounded agent task completes within 25 minutes.
- Secret denial and recovery are completed without facilitator intervention.
- At least two of three participants rate setup and first-task confidence 4/5 or higher.
- No participant copies a credential into Woo or commits generated artifacts.

Any threshold miss becomes a tracked issue before the next public release.
Aggregate only timings and usability observations; never attach provider output,
workspace content, usernames, or credentials.

## Reporting

Copy the JSON template once per participant into an untracked `trial-results/`
directory. Use participant IDs such as `P01`, never names or email addresses.
Summarize recurring friction in a repository issue using the Developer Trial
issue form. Raw results should remain private when they could identify a person.
