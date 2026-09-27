// PowerShell 7 exports its own PSModulePath. Passing that to Windows PowerShell 5.1
// can load incompatible modules (for example making Get-FileHash disappear).
export function windowsPowerShellEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === 'psmodulepath') delete environment[key];
  }
  return environment;
}
