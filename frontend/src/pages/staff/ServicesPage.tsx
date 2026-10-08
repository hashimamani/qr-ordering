import { DestinationDashboardPage } from './DestinationDashboardPage';

/**
 * Third station, for items that are neither cooked nor poured -- carwash
 * and laundry at a venue that sells them alongside food and drink.
 * Identical to Kitchen and Bar because a station is a queue and a role.
 */
export function ServicesPage() {
  return <DestinationDashboardPage destination="services" title="Services" />;
}
