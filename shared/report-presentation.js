// Server supplies this only after exact reviewed-copy/source proof validation.
export function datedReport(a){return a?.presentation?.kind==='dated_report' && a.presentation.event_date==='2026-11-22';}
export function reportPublicationLabel(a,language='ar'){return datedReport(a)?(language==='en'?'Published':'نُشر'):'';}
export function reportEventLabel(a,language='ar'){return datedReport(a)?(language==='en'?'Event: November 22, 2026':'الحدث: 22 تشرين الثاني 2026'):'';}
export function reportBadgeLabel(a,language='ar'){return datedReport(a)?(language==='en'?'Report':'خبر'):null;}
