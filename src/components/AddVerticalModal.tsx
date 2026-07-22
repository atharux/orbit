import { useState } from 'react'
import type { Vertical } from '../types'
import { categoryDisplayName } from '../scraper'

const PRESET_COLORS = [
  '#8B5CF6', '#F97316', '#10B981', '#06B6D4',
  '#EC4899', '#64748B', '#F2540B', '#EAB308',
  '#3B82F6', '#14B8A6',
]

const PRESET_ICONS = ['◆', '◈', '◉', '◎', '◇', '○', '●', '◐', '◑', '◒', '◓', '■', '□', '▲', '△', '▼']

interface OsmPreset {
  label: string
  cat: string
  keywords: string[]
}

const OSM_PRESETS: OsmPreset[] = [
  // Food & Drink
  { label: 'Restaurant', cat: 'amenity:restaurant', keywords: ['dining', 'food', 'eatery', 'bistro'] },
  { label: 'Café / Coffee shop', cat: 'amenity:cafe', keywords: ['coffee', 'cafeteria', 'tea', 'espresso'] },
  { label: 'Bar / Pub', cat: 'amenity:bar', keywords: ['pub', 'drinks', 'cocktail', 'lounge', 'tavern', 'alcohol'] },
  { label: 'Fast food', cat: 'amenity:fast_food', keywords: ['takeaway', 'burger', 'pizza', 'quick'] },
  { label: 'Nightclub', cat: 'amenity:nightclub', keywords: ['club', 'disco', 'dance', 'night'] },
  { label: 'Music venue', cat: 'amenity:music_venue', keywords: ['concert', 'live music', 'gig', 'band'] },
  { label: 'Bakery', cat: 'shop:bakery', keywords: ['bread', 'pastry', 'patisserie', 'cake'] },
  { label: 'Ice cream / Gelato', cat: 'amenity:ice_cream', keywords: ['gelato', 'frozen yogurt', 'sorbet', 'dessert'] },
  // Fitness & Wellness
  { label: 'Gym / Fitness centre', cat: 'leisure:fitness_centre', keywords: ['gym', 'fitness', 'workout', 'crossfit', 'yoga', 'pilates', 'personal trainer'] },
  { label: 'Sports centre', cat: 'leisure:sports_centre', keywords: ['sports hall', 'athletic', 'club', 'arena'] },
  { label: 'Spa / Sauna', cat: 'leisure:spa', keywords: ['wellness', 'sauna', 'thermal', 'retreat', 'relaxation'] },
  { label: 'Swimming pool', cat: 'leisure:swimming_pool', keywords: ['pool', 'swim', 'aquatic', 'diving'] },
  // Health
  { label: 'Dentist', cat: 'amenity:dentist', keywords: ['dental', 'teeth', 'orthodontist', 'oral'] },
  { label: 'Doctor / Clinic', cat: 'amenity:clinic', keywords: ['clinic', 'doctor', 'GP', 'medical', 'health centre', 'practice'] },
  { label: 'Pharmacy', cat: 'amenity:pharmacy', keywords: ['chemist', 'drugstore', 'medicine', 'drugs'] },
  { label: 'Optician / Eyewear', cat: 'shop:optician', keywords: ['glasses', 'eyewear', 'vision', 'eye care', 'contact lenses'] },
  { label: 'Physiotherapist', cat: 'healthcare:physiotherapist', keywords: ['physio', 'physiotherapy', 'rehab', 'osteopath', 'sports therapy'] },
  { label: 'Veterinary', cat: 'amenity:veterinary', keywords: ['vet', 'animal', 'pet care', 'veterinarian'] },
  { label: 'Massage', cat: 'shop:massage', keywords: ['massage therapy', 'bodywork', 'relaxation', 'deep tissue'] },
  // Beauty & Personal Care
  { label: 'Hairdresser / Barber', cat: 'shop:hairdresser', keywords: ['hair salon', 'barber', 'cut', 'styling', 'colour'] },
  { label: 'Beauty salon', cat: 'shop:beauty', keywords: ['nail', 'waxing', 'aesthetics', 'makeup', 'lashes', 'brows', 'tanning'] },
  { label: 'Tattoo / Piercing', cat: 'shop:tattoo', keywords: ['tattoo', 'piercing', 'ink', 'body art'] },
  // Retail
  { label: 'Clothing / Boutique', cat: 'shop:clothes', keywords: ['fashion', 'apparel', 'boutique', 'clothing', 'wear', 'dress'] },
  { label: 'Florist', cat: 'shop:florist', keywords: ['flowers', 'plants', 'bouquet', 'arrangements', 'flower shop'] },
  { label: 'Bookshop', cat: 'shop:books', keywords: ['books', 'bookstore', 'literature', 'reading'] },
  { label: 'Electronics / Tech', cat: 'shop:electronics', keywords: ['tech', 'gadgets', 'computers', 'phones', 'tablets'] },
  { label: 'Jewellery / Watches', cat: 'shop:jewellery', keywords: ['jewelry', 'rings', 'watches', 'accessories', 'gold', 'silver'] },
  { label: 'Gift shop', cat: 'shop:gift', keywords: ['gifts', 'souvenirs', 'presents', 'novelty'] },
  { label: 'Sports shop', cat: 'shop:sports', keywords: ['sports', 'outdoor', 'athletic gear', 'equipment', 'running'] },
  { label: 'Furniture / Home', cat: 'shop:furniture', keywords: ['home', 'interior', 'decor', 'sofas', 'beds'] },
  { label: 'Bicycle shop', cat: 'shop:bicycle', keywords: ['bike', 'cycling', 'repair', 'cycle'] },
  { label: 'Pet shop', cat: 'shop:pet', keywords: ['pets', 'animals', 'supplies', 'dog', 'cat'] },
  { label: 'Supermarket / Grocery', cat: 'shop:supermarket', keywords: ['grocery', 'food', 'market', 'shopping'] },
  { label: 'Car repair / Garage', cat: 'shop:car_repair', keywords: ['mechanic', 'auto', 'MOT', 'service', 'workshop'] },
  { label: 'Laundry / Dry cleaning', cat: 'shop:laundry', keywords: ['launderette', 'dry cleaning', 'washing', 'clothes care'] },
  { label: 'Garden centre', cat: 'shop:garden_centre', keywords: ['garden', 'plants', 'nursery', 'outdoor', 'landscaping'] },
  // Professional Services
  { label: 'Lawyer / Law firm', cat: 'office:lawyer', keywords: ['legal', 'attorney', 'solicitor', 'law firm', 'barrister'] },
  { label: 'Accountant', cat: 'office:accountant', keywords: ['accounting', 'tax', 'bookkeeping', 'finance', 'CPA'] },
  { label: 'Estate agent', cat: 'office:estate_agent', keywords: ['real estate', 'property', 'realtor', 'lettings', 'rental'] },
  { label: 'Architect', cat: 'office:architect', keywords: ['architecture', 'design', 'building', 'planning'] },
  { label: 'Insurance', cat: 'office:insurance', keywords: ['insurance agent', 'broker', 'cover'] },
  // Trades
  { label: 'Electrician', cat: 'craft:electrician', keywords: ['electrical', 'wiring', 'power', 'solar', 'EV'] },
  { label: 'Plumber', cat: 'craft:plumber', keywords: ['plumbing', 'pipes', 'water', 'drainage', 'heating'] },
  { label: 'Painter / Decorator', cat: 'craft:painter', keywords: ['painting', 'decorator', 'coating', 'decorating'] },
  { label: 'Carpenter / Joiner', cat: 'craft:carpenter', keywords: ['carpentry', 'woodwork', 'joinery', 'furniture', 'timber'] },
  { label: 'Roofer', cat: 'craft:roofer', keywords: ['roofing', 'tiles', 'roof repair', 'slating'] },
  { label: 'HVAC / Heating engineer', cat: 'craft:hvac', keywords: ['heating', 'cooling', 'air conditioning', 'boiler', 'ventilation'] },
  { label: 'Builder / Contractor', cat: 'craft:builder', keywords: ['construction', 'building', 'renovation', 'contractor', 'developer'] },
  { label: 'Locksmith', cat: 'craft:locksmith', keywords: ['locks', 'keys', 'security', 'safe'] },
  { label: 'Photographer', cat: 'craft:photographer', keywords: ['photography', 'studio', 'headshots', 'portraits', 'events', 'wedding'] },
  // Entertainment & Tourism
  { label: 'Cinema', cat: 'amenity:cinema', keywords: ['movies', 'film', 'theater', 'screening'] },
  { label: 'Theatre', cat: 'amenity:theatre', keywords: ['theater', 'performance', 'stage', 'arts', 'drama'] },
  { label: 'Museum', cat: 'tourism:museum', keywords: ['art', 'history', 'culture', 'exhibition'] },
  { label: 'Hotel', cat: 'tourism:hotel', keywords: ['accommodation', 'lodging', 'hostel', 'stay', 'rooms'] },
  { label: 'Art gallery', cat: 'tourism:gallery', keywords: ['gallery', 'art', 'exhibition', 'contemporary'] },
  // Education
  { label: 'Language school', cat: 'amenity:language_school', keywords: ['english', 'language', 'ESL', 'tuition', 'german', 'french'] },
  { label: 'Driving school', cat: 'amenity:driving_school', keywords: ['driving lessons', 'instructor', 'license', 'test'] },
  { label: 'Music school', cat: 'amenity:music_school', keywords: ['music lessons', 'instrument', 'teaching', 'piano', 'guitar'] },
  // Other Services
  { label: 'Co-working space', cat: 'amenity:coworking_space', keywords: ['coworking', 'shared office', 'hot desk', 'remote', 'startup'] },
  { label: 'Car wash', cat: 'amenity:car_wash', keywords: ['car care', 'auto wash', 'detailing', 'valet'] },
  { label: 'Bank', cat: 'amenity:bank', keywords: ['banking', 'financial', 'money', 'branch'] },
]

interface Props {
  initial?: Vertical
  onSave: (v: Omit<Vertical, 'isCustom'>) => void
  onClose: () => void
  onDelete?: (id: string) => void
}

export function AddVerticalModal({ initial, onSave, onClose, onDelete }: Props) {
  const isEdit = !!initial
  const [name, setName] = useState(initial?.name ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? '🏪')
  const [color, setColor] = useState(initial?.color ?? '#8B5CF6')
  const [categories, setCategories] = useState<string[]>(initial?.osmCategories ?? [])
  const [presetSearch, setPresetSearch] = useState('')
  const [catInput, setCatInput] = useState('')
  const [showRawInput, setShowRawInput] = useState(false)

  const filteredPresets = presetSearch.trim()
    ? OSM_PRESETS.filter(p => {
        const q = presetSearch.toLowerCase()
        return (
          p.label.toLowerCase().includes(q) ||
          p.cat.toLowerCase().includes(q) ||
          p.keywords.some(k => k.toLowerCase().includes(q))
        )
      })
    : []

  function addPreset(p: OsmPreset) {
    if (!categories.includes(p.cat)) setCategories(prev => [...prev, p.cat])
    setPresetSearch('')
  }

  function addRawCat() {
    const cat = catInput.trim().toLowerCase().replace(/\s+/g, '_')
    if (cat && !categories.includes(cat)) setCategories(prev => [...prev, cat])
    setCatInput('')
  }

  function removeCat(cat: string) {
    setCategories(prev => prev.filter(c => c !== cat))
  }

  function getLabel(cat: string): string {
    const preset = OSM_PRESETS.find(p => p.cat === cat)
    return preset?.label ?? categoryDisplayName(cat)
  }

  function submit() {
    if (!name.trim()) return
    onSave({
      id: initial?.id ?? name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      name: name.trim(),
      icon,
      color,
      osmCategories: categories,
    })
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{isEdit ? 'Edit vertical' : 'New vertical'}</span>
          <button className="panel-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* Name */}
          <div>
            <div className="field-label">Name</div>
            <input
              className="field-input"
              placeholder="e.g. Gyms, Law Firms, Florists…"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Icon */}
          <div>
            <div className="field-label">Icon</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PRESET_ICONS.map(i => (
                <button
                  key={i}
                  style={{
                    width: 36, height: 36, fontSize: 18,
                    border: `2px solid ${icon === i ? color : 'var(--border)'}`,
                    borderRadius: 'var(--radius)',
                    background: icon === i ? `${color}18` : 'var(--surface-2)',
                    cursor: 'pointer', transition: 'all .1s',
                  }}
                  onClick={() => setIcon(i)}
                >{i}</button>
              ))}
              <input
                style={{ width: 36, height: 36, border: '1px solid var(--border)', borderRadius: 'var(--radius)', textAlign: 'center', fontSize: 16 }}
                value={icon}
                onChange={e => setIcon(e.target.value)}
                maxLength={2}
                title="Or type any emoji"
              />
            </div>
          </div>

          {/* Color */}
          <div>
            <div className="field-label">Accent color</div>
            <div className="color-swatches">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  className={`color-swatch${color === c ? ' selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                style={{ width: 28, height: 28, border: '2px solid var(--border)', borderRadius: '50%', cursor: 'pointer', padding: 0 }}
                title="Custom color"
              />
            </div>
          </div>

          {/* Business types */}
          <div>
            <div className="field-label">
              Business types{' '}
              <span className="text-faint" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 10 }}>
                — what to search for on OpenStreetMap
              </span>
            </div>

            {/* Added chips */}
            {categories.length > 0 && (
              <div className="chip-input-row" style={{ marginBottom: 10 }}>
                {categories.map(cat => (
                  <span
                    key={cat}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 9px', borderRadius: 20,
                      background: `${color}18`, border: `1px solid ${color}`,
                      color: color, fontSize: 11, fontFamily: 'var(--mono)',
                    }}
                  >
                    {getLabel(cat)}
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 12, lineHeight: 1, padding: 0 }}
                      onClick={() => removeCat(cat)}
                    >×</button>
                  </span>
                ))}
              </div>
            )}

            {/* Preset search */}
            <input
              className="field-input"
              placeholder="Search: gym, florist, lawyer, electrician…"
              value={presetSearch}
              onChange={e => setPresetSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const first = filteredPresets.find(p => !categories.includes(p.cat))
                  if (first) addPreset(first)
                }
              }}
            />

            {/* Preset results */}
            {filteredPresets.length > 0 && (
              <div style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                marginTop: 4,
                maxHeight: 200,
                overflowY: 'auto',
              }}>
                {filteredPresets.slice(0, 10).map(p => {
                  const added = categories.includes(p.cat)
                  return (
                    <button
                      key={p.cat}
                      className="preset-item"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        width: '100%', padding: '9px 12px', textAlign: 'left',
                        borderBottom: '1px solid var(--border)',
                        background: added ? 'var(--surface-2)' : 'transparent',
                        opacity: added ? 0.6 : 1,
                        cursor: added ? 'default' : 'pointer',
                      }}
                      onClick={() => !added && addPreset(p)}
                    >
                      <span style={{ fontSize: 13, color: 'var(--text)' }}>{p.label}</span>
                      <span style={{ fontSize: 10, color: added ? '#10B981' : 'var(--faint)', fontFamily: 'var(--mono)', flexShrink: 0, marginLeft: 8 }}>
                        {added ? '✓ added' : p.cat}
                      </span>
                    </button>
                  )
                })}
                {filteredPresets.length > 10 && (
                  <div style={{ padding: '7px 12px', fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--mono)' }}>
                    +{filteredPresets.length - 10} more — refine your search
                  </div>
                )}
              </div>
            )}

            {/* No match — offer raw tag */}
            {presetSearch.trim() && filteredPresets.length === 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 12px', marginTop: 4,
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                fontSize: 12, color: 'var(--muted)',
              }}>
                <span>No preset match.</span>
                <button
                  style={{ color: 'var(--accent)', fontSize: 12, textDecoration: 'underline', cursor: 'pointer' }}
                  onClick={() => {
                    const raw = presetSearch.trim().toLowerCase().replace(/\s+/g, '_')
                    setShowRawInput(true)
                    setCatInput(raw)
                    setPresetSearch('')
                  }}
                >
                  Add "{presetSearch.trim().toLowerCase().replace(/\s+/g, '_')}" as raw tag
                </button>
              </div>
            )}

            {/* Raw tag input (advanced) */}
            {!showRawInput ? (
              <button
                style={{ fontSize: 10, color: 'var(--faint)', fontFamily: 'var(--mono)', marginTop: 8, display: 'block', cursor: 'pointer' }}
                onClick={() => setShowRawInput(true)}
              >
                + add raw OSM tag (advanced)
              </button>
            ) : (
              <div className="add-category-input" style={{ marginTop: 8 }}>
                <input
                  placeholder="e.g. craft:photographer, office:company"
                  value={catInput}
                  onChange={e => setCatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addRawCat() }}
                />
                <button className="btn btn-ghost" style={{ height: 32, padding: '0 10px', fontSize: 11 }} onClick={addRawCat}>
                  Add
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          {isEdit && onDelete && (
            <button
              className="btn btn-danger btn-ghost"
              style={{ marginRight: 'auto' }}
              onClick={() => {
                if (confirm(`Delete "${initial?.name}" vertical? Leads will remain but lose their vertical tag.`)) {
                  onDelete(initial!.id)
                  onClose()
                }
              }}
            >
              Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim()}>
            {isEdit ? 'Save' : 'Create vertical'}
          </button>
        </div>
      </div>
    </div>
  )
}
