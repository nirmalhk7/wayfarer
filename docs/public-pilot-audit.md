# Historical Washington Park public pilot desk audit

**Decision on 2026-11-26** — Leave the public preset disabled in the legacy Denver prototype. Washington Park is a public pedestrian setting worth field review. The source checks below leave two distinct, accessible docking sites unconfirmed. The public coordinates are for desk review only.

## Source checks

| Candidate | Evidence | Gate |
| --- | --- | --- |
| Washington Park Recreation Center and Boathouse | Denver lists both facilities at the same street address and publishes the same map coordinate, `39.7026741, -104.9704622`. The recreation center has limited hours and the boathouse is a permitted event venue. | The shared address pin cannot locate two separate outdoor stopping areas or show access independent of facility hours and event bookings. |
| Washington Park picnic sites 3A and 3B | Denver's Picnic Areas GIS gives site 3A at `39.6982591, -104.9710243` (FID 25) and site 3B at `39.6980295, -104.9707098` (FID 70). Both records indicate accessible picnic sites. The two source points are about 37 m apart by great-circle distance. | With nominal 120 m docking radii, these points can qualify from the same location, so they cannot establish a walking leg. The GIS records alone do not establish the current approach, surface, or safe standing area. |
| Other Washington Park picnic sites | The GIS records mark sites 1, 2 and 4 as lacking ADA access. Denver's park project page identifies accessibility upgrades at 1 and 4 as well as path and pedestrian bridge work. | No official completion or reopening evidence reviewed establishes two separated accessible stops and a continuous route for this cluster. The published construction timeline does not establish current accessibility. |

Denver publishes internal walking loops and general urban park hours. These establish the park's intended public pedestrian use, while access to individual sites can depend on construction, bookings, weather, and posted rules.

- [Denver recreation center](https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Parks-Recreation/Recreation-Centers-Pools-Activities/Recreation-Centers/Washington-Park-Recreation-Center) and [Denver boathouse](https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Parks-Recreation/Park-Permits/Event-Facilities/Washington-Park-Boathouse)
- [Denver Picnic Areas GIS](https://services.arcgis.com/ue9rwulIoeLEI9bj/arcgis/rest/services/Picnic_Areas/FeatureServer/0) and [Washington Park amenities map](https://www.denvergov.org/media/gis/WebDocs/Parks/ParkArt_Washington%20Park.pdf)
- [Denver Washington Park project notices](https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Parks-Recreation/Planning-Design-Construction-Community-Engagement/Park-Facility-Projects/Washington-Park-Projects), [walking loops](https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Parks-Recreation/Urban-Parks-Trails/Trails), and [park access rules](https://denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Parks-Recreation/Urban-Parks-Trails/Park-Rules-Policies)

## Release gate

Confirm distinct public outdoor standing points with non-overlapping docking areas, a continuous accessible walking route, current reopening and public hours, and safe waiting space away from traffic and water. Check the full docking areas for unsafe or off-limits approaches. Test stationary fixes on two device families, with Android background location off for this foreground playtest. Use neutral stop labels when logging timing and outcomes. Leave the preset disabled until these checks are complete.
