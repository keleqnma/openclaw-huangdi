/**
 * Verify Electron window is displayed
 */
const { execSync } = require('child_process');

try {
  // List windows using PowerShell
  const result = execSync('powershell -Command "Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object ProcessName, Id, MainWindowTitle"', {
    encoding: 'utf8',
  });

  console.log('=== Windows with visible UI ===');
  console.log(result);

  // Check for Electron or Multi-Agent windows
  if (result.toLowerCase().includes('electron') || result.toLowerCase().includes('agent')) {
    console.log('\n✓ Electron window found!');
  } else {
    console.log('\n✗ No Electron window detected');
  }
} catch (err) {
  console.error('Error:', err.message);
}
