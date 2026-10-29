import { mountTow } from '../tow/client.mjs';
import { CockpitScene } from './scene.mjs';

mountTow({ Scene: CockpitScene, gameName: 'tow_drivers_seat', namespace: 'tow-cockpit-v1-' });
