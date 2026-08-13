---
title: Secret Resource
type: entity
description: Any file or value the agent must never see in cleartext.
---

## Definition

Secret Resources are matched by path pattern (.env, .env.*, *.pem, *.key, *.p12, id_rsa*, *credentials*, .npmrc auth lines) and by value (entries loaded from matched files). Path matches are denied at read time; value matches are scrubbed from any tool output as <concealed>.
