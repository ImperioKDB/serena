# Google sign-in setup for Serena

The application code is ready for Supabase Auth with Google OAuth, but Google sign-in cannot complete until the OAuth provider is enabled with a Google client ID and secret. Those credentials are intentionally not stored in this repository or requested in chat.

## 1. Create the Google OAuth client

In [Google Cloud Console → Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients), create an OAuth client ID with application type **Web application**.

Add this **Authorized JavaScript origin**:

```text
https://serena-frontend.vercel.app
```

Add this **Authorized redirect URI** (the Supabase Auth callback, not the Serena frontend URL):

```text
https://nmlhcofasxsngmvjjxti.supabase.co/auth/v1/callback
```

Copy the client ID and client secret. Do not put either value in Vite/frontend configuration or GitHub.

## 2. Enable Google in Supabase Auth

Open [Serena’s Supabase Google provider settings](https://supabase.com/dashboard/project/nmlhcofasxsngmvjjxti/auth/providers?provider=Google), enable Google, and enter the Google client ID and secret there. Supabase hosts the OAuth callback, so the client secret remains on the server side.

## 3. Add the allowed return URLs

In [Supabase Auth URL Configuration](https://supabase.com/dashboard/project/nmlhcofasxsngmvjjxti/auth/url-configuration), set the Site URL to:

```text
https://serena-frontend.vercel.app
```

Add these exact redirect URLs:

```text
https://serena-frontend.vercel.app
http://localhost:5173
```

The first is production; the second is Vite local development. Avoid broad wildcard patterns for this initial deployment.

## 4. Try sign-in

Open [Serena](https://serena-frontend.vercel.app), select **Continue with Google**, complete Google’s consent/sign-in flow, and return to Serena. The session is held in the current browser tab’s `sessionStorage`; it is cleared when that tab’s session ends. The API validates each access token with Supabase Auth and does not accept a user ID supplied by the browser.

## Troubleshooting

- **Provider disabled / unsupported provider:** Google has not been enabled in Supabase, or the client ID/secret were not saved.
- **Redirect URL not allowed:** add the exact return URL shown above to Supabase Auth’s redirect allow list. The Google OAuth client’s redirect URI must instead point to the Supabase callback URL.
- **API says sign-in verification is unavailable:** check that the Serena API deployment has `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` configured.
- **Frontend shows auth setup required:** check that the frontend deployment has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configured, then redeploy it.
