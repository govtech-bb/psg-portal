# Public Service Generator -- Portal

A Netlify-hosted portal where Digital Champions upload a PDF of a paper form and get back a clickable HTML prototype. GovTech admins can view a full audit log of all generations.

## Setup

### 1. Deploy to Netlify

Connect this repo to Netlify via GitHub, or drag-and-drop the folder into the Netlify dashboard.

### 2. Enable Netlify Identity

In your Netlify site dashboard: **Identity > Enable Identity**

Then under **Identity > Settings > Registration**: set to **Invite only** so only people you invite can sign up.

### 3. Add environment variable

In **Site settings > Environment variables**, add:

```
ANTHROPIC_API_KEY = your-key-here
```

### 4. Enable Netlify Blobs

Blobs are enabled automatically on Netlify. No extra setup needed.

### 5. Invite users

In **Identity > Users**, invite Digital Champions by email. They will receive a link to set their password.

### 6. Assign the admin role

To give a GovTech admin access to the audit log:
1. Go to **Identity > Users**
2. Click the user
3. Under **Roles**, add `admin`

Digital Champions do not need a role assigned -- they can access the portal by default once invited.

## How it works

- Digital Champions sign in at `/` and land on `/portal`
- They upload a PDF and click "Generate prototype"
- The `generate-form` function sends the PDF to the Claude API and streams back generated HTML
- The result can be previewed in-browser or downloaded as a single HTML file
- Each generation is saved to Netlify Blobs per-user for history
- Every attempt (success or failure) is logged to a shared audit store
- Admins (role: `admin`) can view the audit log at `/audit` and export it as CSV

## File structure

```
index.html                          -- Login page
portal.html                         -- Upload + history (Digital Champions)
audit.html                          -- Audit log (admins only)
assets/portal.css                   -- Shared styles
netlify/functions/generate-form.mjs -- Streams Claude API, writes audit log
netlify/functions/get-history.mjs   -- Returns current user's generation history
netlify/functions/get-audit.mjs     -- Returns full audit log (admin only)
netlify.toml                        -- Redirects and function config
package.json                        -- Dependencies
```

## Notes

- The Anthropic API key is never sent to the client -- it lives only in the serverless function environment
- Generated HTML files are self-contained -- they can be emailed or opened offline (except for the Tailwind CDN and Google Fonts links)
- History is capped at 50 entries per user; audit log is capped at 500 entries
- The streaming function may approach Netlify's 26-second function timeout for very large PDFs -- if this becomes an issue, switch to Netlify Background Functions
