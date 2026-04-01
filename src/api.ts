import { Contact, Note, Activity } from './types';

const API_BASE = '/api';

export const api = {
  contacts: {
    list: (): Promise<Contact[]> => 
      fetch(`${API_BASE}/contacts`).then(res => res.json()),
    get: (id: string): Promise<Contact> => 
      fetch(`${API_BASE}/contacts/${id}`).then(res => res.json()),
    create: (data: Partial<Contact>): Promise<Contact> => 
      fetch(`${API_BASE}/contacts`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(data) 
      }).then(res => res.json()),
    bulkCreate: (contacts: Partial<Contact>[]): Promise<{success: boolean, count: number}> => 
      fetch(`${API_BASE}/contacts/bulk`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(contacts) 
      }).then(res => res.json()),
    update: (id: string, data: Partial<Contact>): Promise<Contact> => 
      fetch(`${API_BASE}/contacts/${id}`, { 
        method: 'PUT', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(data) 
      }).then(res => res.json()),
    delete: (id: string): Promise<{success: boolean}> => 
      fetch(`${API_BASE}/contacts/${id}`, { method: 'DELETE' }).then(res => res.json()),
  },
  notes: {
    list: (contactId: string): Promise<Note[]> => 
      fetch(`${API_BASE}/contacts/${contactId}/notes`).then(res => res.json()),
    create: (contactId: string, data: Partial<Note>): Promise<Note> => 
      fetch(`${API_BASE}/contacts/${contactId}/notes`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(data) 
      }).then(res => res.json()),
    update: (id: string, data: Partial<Note>): Promise<Note> => 
      fetch(`${API_BASE}/notes/${id}`, { 
        method: 'PUT', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(data) 
      }).then(res => res.json()),
    delete: (id: string): Promise<{success: boolean}> => 
      fetch(`${API_BASE}/notes/${id}`, { method: 'DELETE' }).then(res => res.json()),
  },
  activities: {
    list: (contactId: string): Promise<Activity[]> => 
      fetch(`${API_BASE}/contacts/${contactId}/activities`).then(res => res.json()),
    create: (contactId: string, data: Partial<Activity>): Promise<Activity> => 
      fetch(`${API_BASE}/contacts/${contactId}/activities`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(data) 
      }).then(res => res.json()),
    update: (id: string, data: Partial<Activity>): Promise<Activity> => 
      fetch(`${API_BASE}/activities/${id}`, { 
        method: 'PUT', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(data) 
      }).then(res => res.json()),
    delete: (id: string): Promise<{success: boolean}> => 
      fetch(`${API_BASE}/activities/${id}`, { method: 'DELETE' }).then(res => res.json()),
  }
};
