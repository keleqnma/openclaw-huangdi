/**
 * Huangdi Dashboard - Event Store
 * Handles event storage and replay control
 */

import type { ReplayState } from './types';
import type { TimelineEvent, EventFilter } from '../types/events';
import { filterEvents } from '../types/events';

/**
 * EventStore - Manages dashboard events with replay support
 */
export class EventStore {
  private events: TimelineEvent[] = [];
  private maxEvents: number;
  private replayState: ReplayState = {
    isPlaying: false,
    speed: 1,
    currentPosition: Date.now(),
  };

  constructor(maxEvents: number = 1000) {
    this.maxEvents = maxEvents;
  }

  /**
   * Add an event to the store
   */
  add(event: TimelineEvent): void {
    this.events.push(event);

    // Trim old events if exceeding max
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(this.events.length - this.maxEvents);
    }
  }

  /**
   * Get events since a timestamp, optionally filtered by agent
   */
  getEventsSince(since: number, agentId?: string): TimelineEvent[] {
    return this.events.filter(event => {
      const timeMatch = event.timestamp >= since;
      const agentMatch = agentId ? event.agentId === agentId : true;
      return timeMatch && agentMatch;
    });
  }

  /**
   * Get all events (for sync)
   */
  getAllEvents(): TimelineEvent[] {
    return [...this.events];
  }

  /**
   * Get events in a time range (for replay)
   */
  getEventsInRange(from: number, to: number): TimelineEvent[] {
    return this.events.filter(
      event => event.timestamp >= from && event.timestamp <= to
    );
  }

  /**
   * Get filtered events using EventFilter
   */
  getFilteredEvents(filter: EventFilter): TimelineEvent[] {
    return filterEvents(this.events, filter);
  }

  /**
   * Update replay state
   */
  updateReplayState(update: Partial<ReplayState>): void {
    this.replayState = { ...this.replayState, ...update };
  }

  /**
   * Get current replay state
   */
  getReplayState(): ReplayState {
    return { ...this.replayState };
  }

  /**
   * Get the next event to replay based on current position
   */
  getNextReplayEvent(): TimelineEvent | undefined {
    if (!this.replayState.isPlaying) return undefined;

    const { from, to, currentPosition } = this.replayState;
    if (!from || !to) return undefined;

    // Find the next event after current position
    const nextEvent = this.events.find(
      event => event.timestamp > currentPosition && event.timestamp <= to
    );

    return nextEvent;
  }

  /**
   * Calculate the next replay tick interval based on speed
   */
  getReplayTickInterval(): number {
    const baseInterval = 1000; // 1 second base
    return baseInterval / this.replayState.speed;
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = [];
    this.replayState = {
      isPlaying: false,
      speed: 1,
      currentPosition: Date.now(),
    };
  }
}
