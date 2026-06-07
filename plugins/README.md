# OBSIDIAN Plugins

Place `.js` files here to add custom tool wrappers.

## Format

```js
module.exports = {
  id:      'mytool',           // unique ID, used as module key
  name:    'My Tool',          // display name
  tag:     'custom',           // tag shown in module list
  desc:    'What it does',     // description in Tools tab
  binary:  'mytool',           // binary name for install check
  install: 'apt:mytool',       // install hint

  // Build args array for this tool
  buildArgs: (target, host, profile) => [
    '-u', target,
    '--some-flag',
  ],

  // Parse a line of output — return a finding or null
  parseOutput: (line) => {
    if (/vulnerable/i.test(line))
      return { sev: 'HIGH', title: 'Vuln Found', detail: line.trim() };
    return null;
  },
};
```

Restart OBSIDIAN after adding plugins. Click Reload in the Plugins tab to refresh the list.
