import React from 'react';
/** Small monochrome UI glyphs. Accessible names belong to the owning control. */
export type IconName = 'library'|'image'|'video'|'audio'|'error'|'previous'|'next'|'play'|'pause';
export function Icon({name}:{name:IconName}) {
  const shapes:Record<IconName,React.ReactNode>={
    library:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    image:<><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>,
    video:<><rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 10 6-4v12l-6-4"/></>,
    audio:<><path d="M9 17V5l11-2v12M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/></>,
    error:<><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/></>,
    previous:<path d="m14 6-6 6 6 6"/>,next:<path d="m10 6 6 6-6 6"/>,
    play:<path d="m8 5 11 7-11 7Z" fill="currentColor" stroke="none"/>,pause:<><path d="M8 5v14M16 5v14" strokeWidth="4"/></>,
  };
  return <svg className="studio-icon" data-icon={name} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}
