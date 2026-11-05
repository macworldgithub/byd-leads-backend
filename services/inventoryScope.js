const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const allSites = value => /^(all|all sites|all locations|all yards|all departments|all sites & yards)$/i.test(String(value || '').trim());

function inventorySiteRegex(site) {
  const name = String(site).trim().replace(/\s+VIC$/i, '').replace(/^BYD\s+/i, '');
  const aliases = {
    'caroline springs': ['Caroline Springs', 'CS'],
    nunawading: ['Nunawading', 'NWD'],
    fairfield: ['Fairfield', 'FFD'],
    doncaster: ['Doncaster', 'DC'],
    wodonga: ['Wodonga', 'WDG'],
    melbourne: ['Melbourne', 'Melbourne City', 'CBD'],
    'melbourne city': ['Melbourne', 'Melbourne City', 'CBD'],
  };
  const names = aliases[name.toLowerCase()] || [name];
  // Anchoring preserves brand boundaries: BYD Melbourne must not match Denza Melbourne.
  return new RegExp(`^\\s*(?:BYD\\s+)?(?:${names.map(escapeRegex).join('|')})(?:\\s+VIC)?\\s*$`, 'i');
}

function inventoryScope(user) {
  if (!user) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  const site = user.locked_site || (user.all_sites !== true ? user.site || user.allowed_sites?.[0] : '');
  if (site && !allSites(site)) {
    const regex = inventorySiteRegex(site);
    return { site, filter: { $or: [
      { location: regex }, { orderYard: regex }, { 'shirleyData.outBoundStore': regex },
    ] } };
  }
  if (user.all_sites === true) return { site: '', filter: {} };
  throw Object.assign(new Error('No inventory site is assigned to this account.'), { statusCode: 403 });
}

function queryKey(filter) {
  return JSON.stringify(filter, (_key, value) =>
    Object.prototype.toString.call(value) === '[object RegExp]' ? { source: value.source, flags: value.flags } : value);
}

module.exports = { inventoryScope, inventorySiteRegex, queryKey };
