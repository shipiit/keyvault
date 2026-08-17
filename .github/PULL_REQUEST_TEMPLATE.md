# What this changes

<!-- What behaviour is different afterwards, and why. -->

## Why

<!-- The problem being solved. Link the issue if there is one: Fixes #123 -->

## How it was verified

<!--
Not "tests pass" — which tests, and what would have failed before.

A test that passes both with and without your change is testing nothing. If
you fixed a bug, the most useful thing you can say is that you reverted the
fix and watched the new test fail.
-->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] New behaviour has a test, and I confirmed it fails without the change
- [ ] No secrets, real credentials, or personal data in code, tests, or fixtures
- [ ] No new network request (or it is explained below and off by default)

## Security impact

<!--
Answer even if the answer is "none".

Say so explicitly if this touches: key derivation or storage, the message
router in src/background/messages.js, anything a content script can reach,
or what gets written to disk.
-->
