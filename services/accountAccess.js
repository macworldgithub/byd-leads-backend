const siteKey = value => String(value || '').trim().toLowerCase().replace(/^byd\s+/, '').replace(/\s+vic$/, '').replace(/[^a-z0-9]/g, '').replace(/^melbourne$/, 'melbournecity');
const hasPlatform = (user, platform) => !Array.isArray(user.platform_access) || user.platform_access.includes(platform);
function resolveSite(user, requested) {
  if (!Array.isArray(user.allowed_sites) || user.all_sites === true) return user.locked_site || '';
  if (!user.allowed_sites.length) throw Object.assign(new Error('No sites are assigned to this account.'), { statusCode: 403 });
  if (!requested || /^(all|all sites|all locations|all yards|all departments|all sites & yards)$/i.test(requested)) return user.allowed_sites.find(s => siteKey(s) === siteKey(user.site)) || user.allowed_sites[0];
  const site = user.allowed_sites.find(s => siteKey(s) === siteKey(requested));
  if (!site) throw Object.assign(new Error('You do not have access to this site.'), { statusCode: 403 });
  return site;
}
async function guardResourceSite(req, db) {
  if (!Array.isArray(req.user?.allowed_sites) || req.user.all_sites || !req.originalUrl) return;
  const [, , resource, reference, extra] = req.originalUrl.split('?')[0].split('/');
  const collections = { leads: 'leads', inventory: 'inventories', appointments: 'appointments', conversations: 'conversations' };
  if (['settings', 'dealerships'].includes(resource) && req.method !== 'GET') throw Object.assign(new Error('This action requires access to all sites.'), { statusCode: 403 });
  if (!collections[resource] || !reference || ['dealerships', 'stats', 'inbound', 'status'].includes(reference)) return;
  const byLead = resource === 'conversations' && reference === 'by-lead';
  const id = decodeURIComponent(byLead ? extra || '' : reference);
  if (!/^[a-f\d]{24}$/i.test(id)) return;
  const { Types } = require('mongoose');
  const doc = await db.collection(byLead ? 'leads' : collections[resource]).findOne({ _id: new Types.ObjectId(id) });
  const site = doc?.site || doc?.dealer || doc?.dealership || doc?.location || doc?.yard;
  if (!doc || !req.user.allowed_sites.some(s => siteKey(s) === siteKey(site))) throw Object.assign(new Error('Record not found.'), { statusCode: 404 });
}
module.exports = { hasPlatform, resolveSite, guardResourceSite };
