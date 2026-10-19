New Azure Web Apps get a unique default hostname, not <name>.azurewebsites.net.

Format `<name>-<random>.<region>-01.azurewebsites.net` (ours: family-recipes-dean-cph4g5cuh9fmhhfy.ukwest-01.azurewebsites.net; Kudu: the same with .scm. before the region). Azure CLI older than 2.60 fails against these with WSAECONNRESET: upgrade the CLI. NEXT_PUBLIC_SITE_URL (baked at build), the Supabase Auth Site URL / redirect URLs and the smoke-test URLs must all use this hostname; changing region or recreating the app changes it and requires a rebuilt zip.
