// Shared small avatar circle for a person's name — used anywhere a
// practitioner/staff member needs a quick visual identifier: the Staff
// Roster/Practitioners tables (RegisterPractitionerForm.jsx), the admin
// header "who am I" chip (AdminDashboard.jsx), and BillingManager.jsx's
// Invoice Status/Completed Bills tables.
//
// Renders a real uploaded photo when one is available (profilePicture —
// a data:image/... URL stored directly on practitioners.profile_picture,
// see backend/index.js's POST /api/practitioner/profile-picture), falling
// back to a colored initials circle otherwise. The fallback color is
// picked deterministically from the name (a simple char-code hash into a
// fixed palette) rather than a single fixed color, so avatars stay visually
// distinguishable in a list instead of every initials-only person looking
// identical.
const AVATAR_COLORS = ['bg-blue-600', 'bg-teal-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600', 'bg-cyan-600'];

function colorForName(name) {
  const sum = name.split('').reduce((total, ch) => total + ch.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

// size: Tailwind arbitrary size token (e.g. 'size-7', 'size-6') so callers
// can match their own row density instead of this component picking one
// fixed size for every use site.
export function PractitionerAvatar({ name, profilePicture, size = 'size-7', onPhotoClick }) {
  const initials = (name || '').split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

  if (profilePicture) {
    const imgClassName = `${size} rounded-full object-cover flex-shrink-0`;
    if (onPhotoClick) {
      return (
        <button
          type="button"
          onClick={onPhotoClick}
          className={`${size} rounded-full flex-shrink-0 cursor-pointer ring-offset-1 hover:ring-2 hover:ring-blue-400 transition-all`}
          title="View photo"
        >
          <img src={profilePicture} alt="" className={imgClassName} />
        </button>
      );
    }
    return <img src={profilePicture} alt="" className={imgClassName} />;
  }

  return (
    <div className={`${size} rounded-full ${colorForName(name || '')} flex items-center justify-center flex-shrink-0`}>
      <span className="text-white text-[11px] font-bold">{initials}</span>
    </div>
  );
}
