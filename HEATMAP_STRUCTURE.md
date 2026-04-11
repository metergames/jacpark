# Parking Heatmap Structure

## Overview

A heatmap visualization system has been implemented to show parking intensity across the campus. The structure is ready to be connected to parking event data.

## Components

### 1. **ParkingMap.tsx** - Main Heatmap Display
- **Heatmap Layer**: Renders a heat visualization on the Mapbox map
- **Color Gradient**: 
  - Blue (#51bbd6): Cooler areas (low parking activity)
  - Yellow (#f1f075): Medium activity
  - Red (#f05337): High activity
  - Dark Red (#b41135): Highest parking density
- **Dynamic Update**: Heatmap updates whenever reports change
- **Zoom-adaptive**: Heatmap radius and opacity adjust based on zoom level

### 2. **heatmap.ts** - Utility Functions

#### Key Functions:

**`convertParkingEventsToHeatmapPoints(events)`**
- Converts parking events into heatmap data points
- Applies time decay: data older than 2 hours gradually loses weight
- Weights are normalized between 0-1

**`aggregateHeatmapData(points, radiusMeters)`**
- Clusters nearby parking events within specified radius (default: 50m)
- Averages coordinates and weights of clustered points
- Useful for performance and visual clarity

**`haversineDistance(lat1, lon1, lat2, lon2)`**
- Calculates accurate distance between two coordinates in meters
- Used for clustering and geographic calculations

### 3. **Data Structure**

#### ParkingEvent Interface
```typescript
interface ParkingEvent {
    id: string;
    latitude: number;
    longitude: number;
    timestamp: string;
    intensity: "high" | "medium" | "low";
}
```

#### Current Implementation (via Reports)
The system currently uses parking report data:
- **High intensity**: Lot marked as "full"
- **Medium intensity**: Lot marked as "limited"
- **Low intensity**: Lot marked as "open"

## How It Works

1. **Reports are submitted** via the form in ParkingMap.tsx
2. **Coordinates are captured** from user's geolocation
3. **Heatmap updates** automatically when new reports come in
4. **Color intensity** reflects parking availability status
5. **Time decay** causes old reports to fade in importance

## To Connect Real Parking Data

When actual users can "park" their car:

1. **Create a new API endpoint**: `POST /api/parking/events`
   - Accept: `{ latitude, longitude, lotId, userId }`
   - Store parking events in database

2. **Update API response schema**:
   - Modify `/api/reports` or create new endpoint to include `latitude` and `longitude`

3. **Hook into "Park" button**:
   ```typescript
   const handlePark = async () => {
       const position = await getCurrentPosition();
       await fetch('/api/parking/events', {
           method: 'POST',
           body: JSON.stringify({
               latitude: position.latitude,
               longitude: position.longitude,
               lotId: selectedLot.id,
           }),
       });
   };
   ```

4. **Use aggregation for performance**:
   - For high-volume parking data, use `aggregateHeatmapData()` before rendering
   - This prevents the heatmap from becoming unclear with too many points

## Future Enhancements

- [ ] Real-time WebSocket updates for live heatmap changes
- [ ] Time-slider to view historical parking patterns
- [ ] Cluster control (toggle aggregation on/off)
- [ ] Export heatmap data for analysis
- [ ] Integration with parking duration tracking
- [ ] Predictive heatmaps based on time of day/day of week
