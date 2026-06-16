// Analytics dashboard page — page-level scaffolding strings (EN · ES · FR).
//
// Cookie-based (Phase 3): analytics.astro reads getLang(Astro.request) and
// selects via getAnalytics(lang). These are the strings the PAGE owns —
// headings, section labels, table headers, empty states, and form labels.
// Internal-only admin page (noindex); ES/FR are first-pass.
//
// Technical labels (route_key, ts, ms, cc, etc.) stay English — they are
// column abbreviations for developer/admin use, not end-user UI.

import type { Lang } from '@/lib/i18n/locale';

export interface AnalyticsLocale {
  lang: Lang;
  pageTitle: string;
  heading: string;
  subheading: string;
  // GA4 section
  ga4Heading: string;
  ga4Unavailable: string;
  ga4LabelUsers: string;
  ga4LabelNewUsers: string;
  ga4LabelSessions: string;
  ga4LabelCheckerViews: string;
  ga4LabelLoginViews: string;
  ga4LabelCheckerToLogin: string;
  ga4TopPages: string;
  ga4PageCol: string;
  ga4ViewsCol: string;
  ga4UsersCol: string;
  ga4Sources: string;
  ga4SourceCol: string;
  ga4SessionsCol: string;
  ga4Countries: string;
  ga4CountryCol: string;
  // Date filter form
  formDayLabel: string;
  formShowLogs: string;
  formRefresh: string;
  // Totals cards
  cardDay: string;
  cardRequests: string;
  cardAvgMs: string;
  cardMaxMs: string;
  // Route table
  topRoutes: string;
  colRoute: string;
  colRequests: string;
  colAvgMs: string;
  noRowsForDay: string;
  // Status codes table
  statusCodes: string;
  colStatus: string;
  noRows: string;
  // Countries table
  countries: string;
  colCountry: string;
  // Detailed logs
  recentLogs: string;
  noDetailedLogs: string;
  // Scam checker section
  checkerHeading: string;
  checkerLabelTotal: string;
  checkerLabelUniqueUsers: string;
  checkerLabelUniqueAddresses: string;
  checkerLabelCacheHits: string;
  checkerNoData: string;
  checkerDailyHeading: string;
  checkerColDate: string;
  checkerColChecks: string;
  checkerColUniqueUsers: string;
  checkerPerUserHeading: string;
  checkerColUserHash: string;
  checkerColTotalChecks: string;
  checkerColUniqueAddresses: string;
  checkerColLastSeen: string;
}

export const en: AnalyticsLocale = {
  lang: 'en',
  pageTitle: 'Analytics | Almstins',
  heading: 'Analytics',
  subheading: 'Daily aggregates + (optional) last 100 detailed logs.',
  // GA4
  ga4Heading: 'Google Analytics · Last 28 days',
  ga4Unavailable: 'Google Analytics data unavailable — check GA4_PROPERTY_ID and GA4_PRIVATE_KEY in .env',
  ga4LabelUsers: 'Users',
  ga4LabelNewUsers: 'New Users',
  ga4LabelSessions: 'Sessions',
  ga4LabelCheckerViews: 'Scam Checker Views',
  ga4LabelLoginViews: 'Login Page Views',
  ga4LabelCheckerToLogin: 'Checker → Login',
  ga4TopPages: 'Top Pages',
  ga4PageCol: 'Page',
  ga4ViewsCol: 'Views',
  ga4UsersCol: 'Users',
  ga4Sources: 'Sources',
  ga4SourceCol: 'Source',
  ga4SessionsCol: 'Sessions',
  ga4Countries: 'Countries',
  ga4CountryCol: 'Country',
  // Form
  formDayLabel: 'Day (UTC)',
  formShowLogs: 'Show last 100 detailed logs',
  formRefresh: 'Refresh',
  // Totals
  cardDay: 'Day',
  cardRequests: 'Requests',
  cardAvgMs: 'Avg ms',
  cardMaxMs: 'Max ms',
  // Routes
  topRoutes: 'Top routes',
  colRoute: 'Route',
  colRequests: 'Requests',
  colAvgMs: 'Avg ms',
  noRowsForDay: 'No rows for that day.',
  // Status
  statusCodes: 'Status codes',
  colStatus: 'Status',
  noRows: 'No rows.',
  // Countries
  countries: 'Countries',
  colCountry: 'Country',
  // Logs
  recentLogs: 'Recent detailed logs (last 100)',
  noDetailedLogs: 'No detailed logs yet.',
  // Checker
  checkerHeading: 'Scam Checker · All-time',
  checkerLabelTotal: 'Total Checks',
  checkerLabelUniqueUsers: 'Unique Users',
  checkerLabelUniqueAddresses: 'Unique Addresses',
  checkerLabelCacheHits: 'Cache Hits',
  checkerNoData: 'No checks recorded yet.',
  checkerDailyHeading: 'Daily Activity (last 30 days)',
  checkerColDate: 'Date',
  checkerColChecks: 'Checks',
  checkerColUniqueUsers: 'Unique Users',
  checkerPerUserHeading: 'Per-User Breakdown (top 50, IPs hashed)',
  checkerColUserHash: 'User (hash)',
  checkerColTotalChecks: 'Total Checks',
  checkerColUniqueAddresses: 'Unique Addresses',
  checkerColLastSeen: 'Last Seen',
};

export const es: AnalyticsLocale = {
  lang: 'es',
  pageTitle: 'Analíticas | Almstins',
  heading: 'Analíticas',
  subheading: 'Agregados diarios + (opcional) últimos 100 registros detallados.',
  // GA4
  ga4Heading: 'Google Analytics · Últimos 28 días',
  ga4Unavailable: 'Datos de Google Analytics no disponibles — verifica GA4_PROPERTY_ID y GA4_PRIVATE_KEY en .env',
  ga4LabelUsers: 'Usuarios',
  ga4LabelNewUsers: 'Nuevos usuarios',
  ga4LabelSessions: 'Sesiones',
  ga4LabelCheckerViews: 'Vistas del verificador',
  ga4LabelLoginViews: 'Vistas de inicio de sesión',
  ga4LabelCheckerToLogin: 'Verificador → Inicio de sesión',
  ga4TopPages: 'Páginas principales',
  ga4PageCol: 'Página',
  ga4ViewsCol: 'Vistas',
  ga4UsersCol: 'Usuarios',
  ga4Sources: 'Fuentes',
  ga4SourceCol: 'Fuente',
  ga4SessionsCol: 'Sesiones',
  ga4Countries: 'Países',
  ga4CountryCol: 'País',
  // Form
  formDayLabel: 'Día (UTC)',
  formShowLogs: 'Mostrar últimos 100 registros detallados',
  formRefresh: 'Actualizar',
  // Totals
  cardDay: 'Día',
  cardRequests: 'Solicitudes',
  cardAvgMs: 'Ms promedio',
  cardMaxMs: 'Ms máximo',
  // Routes
  topRoutes: 'Rutas principales',
  colRoute: 'Ruta',
  colRequests: 'Solicitudes',
  colAvgMs: 'Ms promedio',
  noRowsForDay: 'Sin registros para ese día.',
  // Status
  statusCodes: 'Códigos de estado',
  colStatus: 'Estado',
  noRows: 'Sin registros.',
  // Countries
  countries: 'Países',
  colCountry: 'País',
  // Logs
  recentLogs: 'Registros detallados recientes (últimos 100)',
  noDetailedLogs: 'Sin registros detallados aún.',
  // Checker
  checkerHeading: 'Verificador de fraudes · Histórico',
  checkerLabelTotal: 'Total de verificaciones',
  checkerLabelUniqueUsers: 'Usuarios únicos',
  checkerLabelUniqueAddresses: 'Direcciones únicas',
  checkerLabelCacheHits: 'Aciertos de caché',
  checkerNoData: 'Aún no hay verificaciones registradas.',
  checkerDailyHeading: 'Actividad diaria (últimos 30 días)',
  checkerColDate: 'Fecha',
  checkerColChecks: 'Verificaciones',
  checkerColUniqueUsers: 'Usuarios únicos',
  checkerPerUserHeading: 'Desglose por usuario (top 50, IPs anonimizadas)',
  checkerColUserHash: 'Usuario (hash)',
  checkerColTotalChecks: 'Total de verificaciones',
  checkerColUniqueAddresses: 'Direcciones únicas',
  checkerColLastSeen: 'Última actividad',
};

export const fr: AnalyticsLocale = {
  lang: 'fr',
  pageTitle: 'Analytique | Almstins',
  heading: 'Analytique',
  subheading: 'Agrégats quotidiens + (optionnel) 100 derniers journaux détaillés.',
  // GA4
  ga4Heading: 'Google Analytics · 28 derniers jours',
  ga4Unavailable: 'Données Google Analytics indisponibles — vérifiez GA4_PROPERTY_ID et GA4_PRIVATE_KEY dans .env',
  ga4LabelUsers: 'Utilisateurs',
  ga4LabelNewUsers: 'Nouveaux utilisateurs',
  ga4LabelSessions: 'Sessions',
  ga4LabelCheckerViews: 'Vues du vérificateur',
  ga4LabelLoginViews: 'Vues de la page de connexion',
  ga4LabelCheckerToLogin: 'Vérificateur → Connexion',
  ga4TopPages: 'Pages principales',
  ga4PageCol: 'Page',
  ga4ViewsCol: 'Vues',
  ga4UsersCol: 'Utilisateurs',
  ga4Sources: 'Sources',
  ga4SourceCol: 'Source',
  ga4SessionsCol: 'Sessions',
  ga4Countries: 'Pays',
  ga4CountryCol: 'Pays',
  // Form
  formDayLabel: 'Jour (UTC)',
  formShowLogs: 'Afficher les 100 derniers journaux détaillés',
  formRefresh: 'Actualiser',
  // Totals
  cardDay: 'Jour',
  cardRequests: 'Requêtes',
  cardAvgMs: 'Ms moyen',
  cardMaxMs: 'Ms max',
  // Routes
  topRoutes: 'Routes principales',
  colRoute: 'Route',
  colRequests: 'Requêtes',
  colAvgMs: 'Ms moyen',
  noRowsForDay: 'Aucune ligne pour ce jour.',
  // Status
  statusCodes: 'Codes de statut',
  colStatus: 'Statut',
  noRows: 'Aucune ligne.',
  // Countries
  countries: 'Pays',
  colCountry: 'Pays',
  // Logs
  recentLogs: 'Journaux détaillés récents (100 derniers)',
  noDetailedLogs: 'Aucun journal détaillé pour l\'instant.',
  // Checker
  checkerHeading: 'Vérificateur de fraudes · Historique',
  checkerLabelTotal: 'Vérifications totales',
  checkerLabelUniqueUsers: 'Utilisateurs uniques',
  checkerLabelUniqueAddresses: 'Adresses uniques',
  checkerLabelCacheHits: 'Succès du cache',
  checkerNoData: 'Aucune vérification enregistrée pour l\'instant.',
  checkerDailyHeading: 'Activité quotidienne (30 derniers jours)',
  checkerColDate: 'Date',
  checkerColChecks: 'Vérifications',
  checkerColUniqueUsers: 'Utilisateurs uniques',
  checkerPerUserHeading: 'Détail par utilisateur (top 50, IPs anonymisées)',
  checkerColUserHash: 'Utilisateur (hash)',
  checkerColTotalChecks: 'Vérifications totales',
  checkerColUniqueAddresses: 'Adresses uniques',
  checkerColLastSeen: 'Dernière activité',
};

const MAP: Record<Lang, AnalyticsLocale> = { en, es, fr };

/** Select the Analytics locale for a language, falling back to English. */
export function getAnalytics(lang: Lang): AnalyticsLocale {
  return MAP[lang] ?? en;
}
