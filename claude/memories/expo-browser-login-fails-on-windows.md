`eas login` through the browser fails on the owner's Windows machine: use an EXPO_TOKEN access token.

Create a token at https://expo.dev/accounts/suremedia111/settings/access-tokens and set `$env:EXPO_TOKEN` for that shell only before `npx eas-cli@latest ...`. Never commit or paste the token in chat (one pasted earlier must be revoked). EAS project: @suremedia111/family-recipes.
