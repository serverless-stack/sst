import { createProxy, parseEnvironment } from "../util";

export interface EventBusResources { }

export const EventBus = createProxy<EventBusResources>("EventBus");
Object.assign(EventBus, parseEnvironment("EventBus", ["eventBusName"]));