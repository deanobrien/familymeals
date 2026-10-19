Deploys use the owner's PERSONAL Azure subscription: separate AZURE_CONFIG_DIR plus device-code login.

Set `$env:AZURE_CONFIG_DIR = "$HOME\.azure-personal"` in each shell, then `az login --use-device-code` and confirm `az account show`. Keeps it apart from any employer login on the same machine. Needs Azure CLI 2.60 or newer. B1 plan quota can be zero in a region: try another region, request quota, or F1 for a throwaway test (docs/DEPLOY-APP-SERVICE.md section 2).
