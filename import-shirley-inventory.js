/**
 * import-shirley-inventory.js
 * Ingests 100% of Shirley's inventory data from all 22 CSV files into MongoDB
 */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('./node_modules/mongoose');
const fs = require('fs');
const path = require('path');

const INVENTORY_DIR = path.resolve(__dirname, '../shirley-inventory');
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://salman:4lanHyMRdCrtXDJ7@sign365.nglnioh.mongodb.net/byd-leads-new?retryWrites=true&w=majority';

// ── Helpers ──────────────────────────────────────────────────────────────────
function clean(str) {
  if (!str) return '';
  const s = String(str).trim();
  if (s === '#N/A' || s === '#VALUE!' || s === '-' || s === '—' || s === 'None' || s === 'null') return '';
  return s;
}

function cleanVin(vin) {
  if (!vin) return null;
  const v = String(vin).trim().toUpperCase();
  if (v.length < 11 || v.includes('VIN') || v.includes('车架号') || v.includes('#VALUE')) return null;
  return v;
}

function normalizeLocation(loc) {
  const s = clean(loc);
  if (!s) return '';
  const lower = s.toLowerCase();
  if (lower.includes('caroline spring') || lower === 'cs' || lower.includes('加罗林温泉')) return 'BYD Caroline Springs';
  if (lower.includes('clayton')) return 'Clayton';
  if (lower.includes('warehouse')) return 'Warehouse';
  if (lower.includes('fairfield') || lower === 'ffd' || lower.includes('费里菲尔德')) return 'BYD Fairfield';
  if (lower.includes('nunawading') || lower === 'nwd' || lower.includes('努纳瓦丁')) return 'BYD Nunawading';
  if (lower.includes('melbourne city') || lower === 'cbd' || lower.includes('melbourne - new')) return 'BYD Melbourne City';
  if (lower === 'byd melbourne') return 'BYD Melbourne';
  if (lower.includes('wodonga') || lower === 'wdg') return 'BYD Wodonga';
  if (lower.includes('doncaster') || lower === 'dc') return 'BYD Doncaster';
  if (lower.includes('holding yard') || lower.includes('derrimut')) return 'Holding Yard VIC';
  if (lower.includes('velo')) return 'VELO';
  if (lower.includes('denza kew') || lower.includes('基由')) return 'DENZA Kew';
  if (lower.includes('denza kingsway') || lower.includes('金斯威')) return 'DENZA Kingsway';
  if (lower.includes('in transit')) return 'In Transit';
  if (lower.includes('delivered')) return 'Delivered';
  return s;
}

function normalizeYard(yard) {
  const s = clean(yard);
  if (!s) return '';
  const lower = s.toLowerCase();
  if (lower.includes('caroline spring') || lower === 'cs') return 'BYD Caroline Springs';
  if (lower.includes('melbourne - new') || lower.includes('melbourne city') || lower === 'cbd') return 'BYD Melbourne City';
  if (lower.includes('doncaster') || lower === 'dc') return 'BYD Doncaster';
  if (lower.includes('fairfield') || lower === 'ffd') return 'BYD Fairfield';
  if (lower.includes('nunawading') || lower === 'nwd') return 'BYD Nunawading';
  if (lower.includes('wodonga') || lower === 'wdg') return 'BYD Wodonga';
  if (lower.includes('holding yard')) return 'Holding Yard VIC';
  if (lower.includes('warehouse')) return 'Warehouse';
  if (lower.includes('clayton')) return 'Clayton';
  return s;
}

function normalizeStatus(st) {
  const s = clean(st);
  if (!s) return 'Available';
  const lower = s.toLowerCase();
  if (lower === 'delivered' || lower === 'deliveried') return 'Delivered';
  if (lower === 'in stock' || lower === 'instock') return 'In Stock';
  if (lower === 'sold') return 'Sold';
  if (lower === 'in transit') return 'In Transit';
  if (lower === 'demo') return 'Demo';
  if (lower === 'display') return 'Display';
  if (lower === 'damage' || lower === 'damaged') return 'Damage';
  if (lower === 'on-hold' || lower === 'on hold') return 'On Hold';
  if (lower === 'allocated') return 'Allocated';
  if (lower === 'service') return 'Service';
  return s;
}

function decodeVinModel(vin) {
  if (!vin || vin.length < 6) return { model: 'Vehicle', badge: '' };
  const p6 = vin.slice(0, 6);
  const p5 = vin.slice(0, 5);

  if (p6 === 'LGXCH4') return { model: 'SEALION 7', badge: 'Premium' };
  if (p6 === 'LGXCF4') return { model: 'SEALION 7', badge: 'Performance' };
  if (p6 === 'LGXCH6') return { model: 'SEAL', badge: 'Premium' };
  if (p6 === 'LGXCF6') return { model: 'SEAL', badge: 'Performance' };
  if (p6.startsWith('LPE19') || p6.startsWith('LPE59')) return { model: 'SHARK 6', badge: 'Premium' };
  if (p6 === 'LC0C76') return { model: 'SEAL 6', badge: 'DM-i' };
  if (p6 === 'LC0C74') return { model: 'SEALION 5', badge: 'Premium' };
  if (p6 === 'LGXCD4') return { model: 'SEALION 6', badge: 'Premium' };
  if (p6 === 'LGXC74') return { model: 'SEALION 6', badge: 'Dynamic' };
  if (p6 === 'LGXCE4') return { model: 'ATTO 3', badge: 'Premium' };
  if (p6 === 'LC0CE4') return { model: 'ATTO 2', badge: 'Premium' };

  if (p5 === 'LGXCH') return { model: 'SEALION 7', badge: '' };
  if (p5 === 'LGXCF') return { model: 'SEALION 7', badge: '' };
  if (p5 === 'LGXCD' || p5 === 'LGXC7') return { model: 'SEALION 6', badge: '' };
  if (p5 === 'LPE19' || p5 === 'LPE59') return { model: 'SHARK 6', badge: '' };
  if (p5 === 'LC0C7') return { model: 'SEALION 5', badge: '' };
  if (p5 === 'LGXCE') return { model: 'ATTO 3', badge: '' };
  if (p5 === 'LC0CE') return { model: 'DOLPHIN', badge: '' };

  return { model: 'Vehicle', badge: '' };
}

function normalizeModel(rawType, rawModel, vin) {
  const t = clean(rawType).toUpperCase();
  const m = clean(rawModel);
  let make = 'BYD';
  let model = '';
  let badge = m;

  if (t.includes('SEALION 7')) model = 'SEALION 7';
  else if (t.includes('SEALION 8')) model = 'SEALION 8';
  else if (t.includes('SEALION 6')) model = 'SEALION 6';
  else if (t.includes('SEALION 5')) model = 'SEALION 5';
  else if (t.includes('SHARK 6') || t.includes('SHARK')) model = 'SHARK 6';
  else if (t.includes('ATTO 1')) model = 'ATTO 1';
  else if (t.includes('ATTO 2')) model = 'ATTO 2';
  else if (t.includes('ATTO 3')) model = 'ATTO 3';
  else if (t.includes('SEAL 6')) model = 'SEAL 6';
  else if (t.includes('SEAL')) model = 'SEAL';
  else if (t.includes('DOLPHIN')) model = 'DOLPHIN';
  else if (t.includes('DENZA')) {
    make = 'DENZA';
    model = t.replace('DENZA', '').trim() || 'D9';
  } else {
    // Attempt VIN decoding if type is unknown or missing
    const decoded = decodeVinModel(vin);
    model = decoded.model !== 'Vehicle' ? decoded.model : (t || 'BYD Vehicle');
    if (!badge) badge = decoded.badge;
  }

  return { make, model, badge };
}

function parseCsvLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

// ── Ingestion Logic ──────────────────────────────────────────────────────────
async function importShirleyInventory() {
  console.log('🔄 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected to MongoDB:', mongoose.connection.name);

  const col = mongoose.connection.collection('inventories');

  console.log('📂 Parsing all Shirley Inventory files from:', INVENTORY_DIR);

  const vehiclesByVin = new Map();

  function getOrCreate(vin) {
    if (!vehiclesByVin.has(vin)) {
      vehiclesByVin.set(vin, {
        vin,
        stock: '',
        model: '',
        make: 'BYD',
        badge: '',
        color: '',
        status: 'Available',
        location: '',
        orderYard: '',
        inStockDate: '',
        daysOfInventory: 0,
        deliveryDate: '',
        delivered: '',
        allocationDate: '',
        salesConsultant: '',
        paymentTermDue: '',
        dueDate: '',
        inBoundDate: '',
        outBoundStore: '',
        rego: '',
        odometer: 0,
        registrationDate: '',
        condition: 'New',
        notes: '',
        buildMonth: '',
        poNumber: '',
        sources: new Set(),
      });
    }
    return vehiclesByVin.get(vin);
  }

  // 1. In-Stock.csv
  const inStockFile = path.join(INVENTORY_DIR, 'DOC-20261102-WA0025-In-Stock.csv');
  if (fs.existsSync(inStockFile)) {
    console.log('  -> Parsing In-Stock.csv...');
    const lines = fs.readFileSync(inStockFile, 'utf-8').split(/\r?\n/);
    const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
    const vinIdx = headers.indexOf('vin');
    const typeIdx = headers.indexOf('veh. type');
    const modelIdx = headers.indexOf('veh. model');
    const colorIdx = headers.indexOf('color');
    const statusIdx = headers.indexOf('status');
    const locIdx = headers.indexOf('location');
    const stockIdx = headers.indexOf('no');
    const inStockDateIdx = headers.indexOf('in stock date');
    const daysIdx = headers.indexOf('days of inventory');
    const deliveryDateIdx = headers.indexOf('delivery date');
    const deliveredIdx = headers.indexOf('delivered');
    const allocIdx = headers.indexOf('allocation date');
    const salesIdx = headers.indexOf('sales');
    const orderYardIdx = headers.indexOf('order yard');
    const paymentDueIdx = headers.indexOf('payment term due');
    const outBoundIdx = headers.indexOf('out bound store');
    const inBoundIdx = headers.indexOf('in bound date');

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const row = parseCsvLine(lines[i]);
      const vin = cleanVin(row[vinIdx]);
      if (!vin) continue;

      const v = getOrCreate(vin);
      v.sources.add('In-Stock');
      if (row[stockIdx]) v.stock = clean(row[stockIdx]);
      const { make, model, badge } = normalizeModel(row[typeIdx], row[modelIdx], vin);
      v.make = make;
      v.model = model;
      v.badge = badge;
      if (row[colorIdx]) v.color = clean(row[colorIdx]);
      if (row[statusIdx]) v.status = normalizeStatus(row[statusIdx]);
      if (row[locIdx]) v.location = normalizeLocation(row[locIdx]);
      if (row[orderYardIdx]) v.orderYard = normalizeYard(row[orderYardIdx]);
      if (row[inStockDateIdx]) v.inStockDate = clean(row[inStockDateIdx]);
      if (row[daysIdx]) v.daysOfInventory = parseInt(clean(row[daysIdx])) || 0;
      if (row[deliveryDateIdx]) v.deliveryDate = clean(row[deliveryDateIdx]);
      if (row[deliveredIdx]) v.delivered = clean(row[deliveredIdx]);
      if (row[allocIdx]) v.allocationDate = clean(row[allocIdx]);
      if (row[salesIdx]) v.salesConsultant = clean(row[salesIdx]);
      if (row[paymentDueIdx]) v.paymentTermDue = clean(row[paymentDueIdx]);
      if (row[outBoundIdx]) v.outBoundStore = clean(row[outBoundIdx]);
      if (row[inBoundIdx]) v.inBoundDate = clean(row[inBoundIdx]);
      if (v.status === 'Demo') v.condition = 'Demo';
    }
  }

  // 2. Due_date.csv
  const dueFile = path.join(INVENTORY_DIR, 'DOC-20261102-WA0025-Due_date.csv');
  if (fs.existsSync(dueFile)) {
    console.log('  -> Parsing Due_date.csv...');
    const lines = fs.readFileSync(dueFile, 'utf-8').split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const row = parseCsvLine(lines[i]);
      const vin = cleanVin(row[0]);
      if (!vin) continue;
      const v = getOrCreate(vin);
      v.sources.add('Due_date');
      v.dueDate = clean(row[1]);
      if (!v.paymentTermDue && v.dueDate) v.paymentTermDue = v.dueDate;
      if (!v.model) {
        const decoded = decodeVinModel(vin);
        v.model = decoded.model;
        if (!v.badge) v.badge = decoded.badge;
      }
    }
  }

  // 3. Free_stock.csv
  const freeFile = path.join(INVENTORY_DIR, 'DOC-20261102-WA0025-Free_stock.csv');
  if (fs.existsSync(freeFile)) {
    console.log('  -> Parsing Free_stock.csv...');
    const lines = fs.readFileSync(freeFile, 'utf-8').split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const row = parseCsvLine(lines[i]);
      const vin = cleanVin(row[1]);
      if (!vin) continue;
      const v = getOrCreate(vin);
      v.sources.add('Free_stock');
      if (!v.model) {
        const { make, model, badge } = normalizeModel(row[2], row[3], vin);
        v.make = make;
        v.model = model;
        v.badge = badge;
      }
      if (!v.color && row[4]) v.color = clean(row[4]);
      if (row[5]) v.status = normalizeStatus(row[5]);
      if (!v.location && row[6]) v.location = normalizeLocation(row[6]);
    }
  }

  // 4. In_Use_DEMO.csv and Retired_DEMO.csv
  for (const demoName of ['DOC-20261102-WA0025-In_Use_DEMO.csv', 'DOC-20261102-WA0025-Retired_DEMO.csv']) {
    const demoFile = path.join(INVENTORY_DIR, demoName);
    if (!fs.existsSync(demoFile)) continue;
    console.log(`  -> Parsing ${demoName}...`);
    const lines = fs.readFileSync(demoFile, 'utf-8').split(/\r?\n/);
    const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
    const vinIdx = headers.indexOf('vin');
    const siteIdx = headers.indexOf('site');
    const typeIdx = headers.indexOf('veh. type');
    const modelIdx = headers.indexOf('veh. model');
    const colorIdx = headers.indexOf('veh. colour');
    const statusIdx = headers.indexOf('status');
    const locIdx = headers.indexOf('location');
    const regDateIdx = headers.indexOf('registration date');
    const plateIdx = headers.indexOf('plate');
    const odoIdx = headers.indexOf('odometer');
    const notesIdx = headers.indexOf('notes');
    const buildIdx = headers.indexOf('build month');

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const row = parseCsvLine(lines[i]);
      const vin = cleanVin(row[vinIdx]);
      if (!vin) continue;
      const v = getOrCreate(vin);
      v.sources.add(demoName.includes('Retired') ? 'Retired_DEMO' : 'In_Use_DEMO');
      v.condition = 'Demo';
      if (!v.model && typeIdx !== -1) {
        const { make, model, badge } = normalizeModel(row[typeIdx], row[modelIdx], vin);
        v.make = make;
        v.model = model;
        v.badge = badge;
      }
      if (!v.color && colorIdx !== -1 && row[colorIdx]) v.color = clean(row[colorIdx]);
      if (statusIdx !== -1 && row[statusIdx]) {
        const st = normalizeStatus(row[statusIdx]);
        if (st === 'Available' || !v.status || v.status === 'Available') v.status = 'Demo';
        else v.status = st;
      } else {
        if (!v.status || v.status === 'Available') v.status = 'Demo';
      }
      if (locIdx !== -1 && row[locIdx] && !v.location) v.location = normalizeLocation(row[locIdx]);
      if (siteIdx !== -1 && row[siteIdx] && !v.orderYard) v.orderYard = normalizeYard(row[siteIdx]);
      if (plateIdx !== -1 && row[plateIdx] && !v.rego) v.rego = clean(row[plateIdx]);
      if (odoIdx !== -1 && row[odoIdx] && !v.odometer) v.odometer = parseInt(clean(row[odoIdx]).replace(/[^\d]/g, '')) || 0;
      if (regDateIdx !== -1 && row[regDateIdx] && !v.registrationDate) v.registrationDate = clean(row[regDateIdx]);
      if (notesIdx !== -1 && row[notesIdx] && !v.notes) v.notes = clean(row[notesIdx]);
      if (buildIdx !== -1 && row[buildIdx] && !v.buildMonth) v.buildMonth = clean(row[buildIdx]);
    }
  }

  // 5. Monthly Inbound sheets (Jan through Dec)
  const inboundFiles = fs.readdirSync(INVENTORY_DIR).filter(f => f.includes('Inbound_') && f.endsWith('.csv'));
  for (const f of inboundFiles) {
    const filePath = path.join(INVENTORY_DIR, f);
    console.log(`  -> Parsing ${f}...`);
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
    if (!lines.length) continue;
    const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
    const vinIdx = headers.indexOf('vin');
    if (vinIdx === -1) continue;
    const poIdx = headers.indexOf('po') !== -1 ? headers.indexOf('po') : headers.indexOf('order number');
    const descIdx = headers.indexOf('vehicle description') !== -1 ? headers.indexOf('vehicle description') : headers.indexOf('vehicle');
    const specIdx = headers.indexOf('specification');
    const extIdx = headers.indexOf('exterior');
    const statusIdx = headers.indexOf('status') !== -1 ? headers.indexOf('status') : headers.indexOf('stauts');
    const locIdx = headers.indexOf('location') !== -1 ? headers.indexOf('location') : headers.indexOf('yard');

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const row = parseCsvLine(lines[i]);
      const vin = cleanVin(row[vinIdx]);
      if (!vin) continue;
      const v = getOrCreate(vin);
      v.sources.add('Inbound');
      if (poIdx !== -1 && row[poIdx] && !v.poNumber) v.poNumber = clean(row[poIdx]);
      if (!v.model && descIdx !== -1 && row[descIdx]) {
        const { make, model, badge } = normalizeModel(row[descIdx], specIdx !== -1 ? row[specIdx] : '', vin);
        v.make = make;
        v.model = model;
        v.badge = badge;
      }
      if (!v.color && extIdx !== -1 && row[extIdx]) v.color = clean(row[extIdx]);
      if (statusIdx !== -1 && row[statusIdx]) {
        const st = normalizeStatus(row[statusIdx]);
        if (!v.status || v.status === 'Available') v.status = st || 'In Transit';
      }
      if (locIdx !== -1 && row[locIdx]) {
        const parsedLoc = normalizeLocation(row[locIdx]);
        if (!v.location) v.location = parsedLoc;
        if (!v.orderYard) v.orderYard = normalizeYard(row[locIdx]);
      }
    }
  }

  // 6. Sheet1.csv
  const sheet1File = path.join(INVENTORY_DIR, 'DOC-20261102-WA0025-Sheet1.csv');
  if (fs.existsSync(sheet1File)) {
    console.log('  -> Parsing Sheet1.csv...');
    const lines = fs.readFileSync(sheet1File, 'utf-8').split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const row = parseCsvLine(lines[i]);
      const vin = cleanVin(row[4]);
      if (!vin) continue;
      const v = getOrCreate(vin);
      v.sources.add('Sheet1');
      if (row[3] && !v.stock) v.stock = clean(row[3]);
      if (row[1]) {
        const st = normalizeStatus(row[1]);
        if (st && (!v.status || v.status === 'Available')) v.status = st;
      }
      if (row[2] && !v.location) v.location = normalizeLocation(row[2]);
      if (row[0] && !v.deliveryDate) v.deliveryDate = clean(row[0]);
    }
  }

  // 7. Sheet2.csv (Outbound store deliveries, demo vehicles, inbound, and actual deliveries)
  const sheet2File = path.join(INVENTORY_DIR, 'DOC-20261102-WA0025-Sheet2.csv');
  if (fs.existsSync(sheet2File)) {
    console.log('  -> Parsing Sheet2.csv...');
    const lines = fs.readFileSync(sheet2File, 'utf-8').split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const row = parseCsvLine(lines[i]);
      
      // Col 0: demo VIN
      const demoVin = cleanVin(row[0]);
      if (demoVin) {
        const v = getOrCreate(demoVin);
        v.sources.add('Sheet2-Demo');
        if (row[1] && !v.location) v.location = normalizeLocation(row[1]);
        if (!v.status || v.status === 'Available') v.status = 'Demo';
        v.condition = 'Demo';
      }

      // Col 5: Outbound store delivery VIN
      const outVin = cleanVin(row[5]);
      if (outVin) {
        const v = getOrCreate(outVin);
        v.sources.add('Sheet2-Outbound');
        if (row[3] && !v.deliveryDate) v.deliveryDate = clean(row[3]);
        if (row[4]) {
          v.outBoundStore = clean(row[4]);
          if (!v.location) v.location = normalizeLocation(row[4]);
          if (!v.orderYard) v.orderYard = normalizeYard(row[4]);
        }
        if (!v.status || v.status === 'Available') v.status = 'Delivered';
      }

      // Col 8: Inbound date VIN
      const inVin = cleanVin(row[8]);
      if (inVin) {
        const v = getOrCreate(inVin);
        v.sources.add('Sheet2-Inbound');
        if (row[7] && !v.inBoundDate) v.inBoundDate = clean(row[7]);
        if (!v.status) v.status = 'In Stock';
        if (!v.location) v.location = 'Warehouse';
      }

      // Col 10: Actual delivery VIN
      const delVin = cleanVin(row[10]);
      if (delVin) {
        const v = getOrCreate(delVin);
        v.sources.add('Sheet2-Delivery');
        if (row[11] && !v.deliveryDate) v.deliveryDate = clean(row[11]);
        if (!v.status || v.status === 'Available') v.status = 'Delivered';
      }

      // Col 13: Extra VIN column
      const col13Vin = cleanVin(row[13]);
      if (col13Vin) {
        const v = getOrCreate(col13Vin);
        v.sources.add('Sheet2-Vin');
      }
    }
  }

  // Final pass: ensure every vehicle has model and location
  for (const v of vehiclesByVin.values()) {
    if (!v.model || v.model === 'Vehicle') {
      const decoded = decodeVinModel(v.vin);
      v.model = decoded.model;
      if (!v.badge) v.badge = decoded.badge;
    }
    if (!v.location) {
      if (v.orderYard) v.location = v.orderYard;
      else if (v.status === 'In Transit') v.location = 'In Transit';
      else v.location = 'Warehouse';
    }
    if (!v.stock) {
      v.stock = v.vin.slice(-6);
    }
  }

  console.log(`\n📊 Ready to upsert ${vehiclesByVin.size} vehicles into MongoDB inventories collection...`);

  // Bulk write in batches of 500
  const vehicles = Array.from(vehiclesByVin.values());
  const batchSize = 500;
  let totalUpserted = 0;
  let totalModified = 0;

  for (let i = 0; i < vehicles.length; i += batchSize) {
    const chunk = vehicles.slice(i, i + batchSize);
    const ops = chunk.map((v) => {
      const title = [v.make || 'BYD', v.model, v.badge].filter(Boolean).join(' ').trim();
      const doc = {
        stock: v.stock,
        model: `BYD ${v.model}`.replace(/^BYD BYD/i, 'BYD'),
        paint: v.color || '',
        location: v.location || 'Warehouse',
        orderYard: v.orderYard || '',
        status: v.status || 'Available',
        price: v.price || '',
        lastSeen: new Date(),
        platform: 'shirley',
        condition: v.condition || (v.status === 'Demo' ? 'Demo' : 'New'),
        itemStatus: v.status === 'In Stock' ? 'InStock' : v.status,
        itemType: 'CAR',
        title: title,
        registration: {
          rego: v.rego || null,
          vin: v.vin,
          hin: null,
        },
        odometer: {
          value: v.odometer || 0,
          unit: 'Kilometres',
        },
        specifications: {
          make: v.make || 'BYD',
          model: v.model,
          badge: v.badge || '',
          series: null,
          year: 2025,
          colour: v.color || '',
          manufacturerColour: v.color || '',
        },
        shirleyData: {
          inStockDate: v.inStockDate || null,
          daysOfInventory: v.daysOfInventory || 0,
          deliveryDate: v.deliveryDate || null,
          delivered: v.delivered || null,
          allocationDate: v.allocationDate || null,
          salesConsultant: v.salesConsultant || null,
          paymentTermDue: v.paymentTermDue || null,
          dueDate: v.dueDate || null,
          inBoundDate: v.inBoundDate || null,
          outBoundStore: v.outBoundStore || null,
          poNumber: v.poNumber || null,
          registrationDate: v.registrationDate || null,
          notes: v.notes || null,
          buildMonth: v.buildMonth || null,
          sources: Array.from(v.sources),
        },
      };

      return {
        updateOne: {
          filter: { 'registration.vin': v.vin },
          update: {
            $set: doc,
            $setOnInsert: {
              createdAt: new Date(),
              listingStats: {
                enquiryCount: 0,
                watchers: 0,
                retailSearchCount: 0,
                retailViewCount: 0,
                photoCount: 0,
                healthScore: 75,
              },
            },
          },
          upsert: true,
        },
      };
    });

    const res = await col.bulkWrite(ops, { ordered: false });
    totalUpserted += (res.upsertedCount || 0);
    totalModified += (res.modifiedCount || 0);
    process.stdout.write(`  Processed ${Math.min(i + batchSize, vehicles.length)} / ${vehicles.length} (Upserted: ${totalUpserted}, Updated: ${totalModified})\r`);
  }

  console.log(`\n\n🎉 INVENTORY IMPORT COMPLETE!`);
  console.log(`  Total Vehicles Processed: ${vehicles.length}`);
  console.log(`  Newly Inserted: ${totalUpserted}`);
  console.log(`  Updated / Enriched: ${totalModified}`);

  const totalInDb = await col.countDocuments({});
  const shirleyInDb = await col.countDocuments({ platform: 'shirley' });
  console.log(`\n📦 Current Database Stats:`);
  console.log(`  Total Inventory in DB: ${totalInDb}`);
  console.log(`  Shirley Inventory in DB: ${shirleyInDb}`);

  process.exit(0);
}

importShirleyInventory().catch((err) => {
  console.error('❌ Import failed:', err);
  process.exit(1);
});
