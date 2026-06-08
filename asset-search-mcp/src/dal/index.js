// DAL entry point: one call builds the database connection plus every DAO.
// The Store (service layer) talks only to this interface, never raw SQL.

import { brainDir, openDatabase, sqliteAvailable } from "./database.js";
import {
  ClaimsDao,
  InspectionsDao,
  PaletteDao,
  PermissionsDao,
  ReviewsDao,
  SearchCacheDao,
} from "./daos.js";

export { brainDir, sqliteAvailable } from "./database.js";

export function createDal(dir = brainDir()) {
  const db = openDatabase(dir);
  return {
    dir,
    db,
    searchCache: new SearchCacheDao(db),
    reviews: new ReviewsDao(db),
    claims: new ClaimsDao(db),
    inspections: new InspectionsDao(db),
    permissions: new PermissionsDao(db),
    palette: new PaletteDao(db),
    close() { db.close(); },
  };
}
