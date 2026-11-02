# PSScriptAnalyzer settings for the Orchestra installers (#28).
#
# Severity gating (which findings fail CI) is done by scripts/lint-install-ps1.sh;
# this file only suppresses rules that are design choices for a console installer,
# not latent defects, so the remaining warnings stay meaningful.
@{
    ExcludeRules = @(
        # An installer IS console output — Write-Host is the correct cmdlet here.
        'PSAvoidUsingWriteHost',
        # A single-file installer uses intentional script-scope variables.
        'PSAvoidGlobalVars'
    )
}
