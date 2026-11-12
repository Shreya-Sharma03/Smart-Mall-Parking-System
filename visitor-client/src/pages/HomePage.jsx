import React from 'react';
import { TOPOLOGY } from '../data/topology';
import { Car, CheckCircle2 } from 'lucide-react';

export default function HomePage() {
  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto', textAlign: 'left', background: '#fff', padding: '2rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: '#eff6ff', padding: '12px', borderRadius: '10px', color: '#2563eb' }}>
          <Car size={32} />
        </div>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a' }}>Smart Mall Visitor Parking</h1>
          <p style={{ color: '#64748b' }}>Frontend Scaffolding & Shared Topology Initialized</p>
        </div>
      </div>

      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '1rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <CheckCircle2 color="#16a34a" size={20} />
        <span style={{ color: '#166534', fontWeight: 600 }}>Milestone 1 Active: Scaffolding and Topology Ready</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div style={{ border: '1px solid #e2e8f0', padding: '1rem', borderRadius: '8px' }}>
          <h3 style={{ fontSize: '0.9rem', color: '#64748b', textTransform: 'uppercase' }}>Total Capacity</h3>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>{TOPOLOGY.totalCapacity} Slots</p>
        </div>
        <div style={{ border: '1px solid #e2e8f0', padding: '1rem', borderRadius: '8px' }}>
          <h3 style={{ fontSize: '0.9rem', color: '#64748b', textTransform: 'uppercase' }}>Floors</h3>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>{TOPOLOGY.floors.join(', ')} (12 slots each)</p>
        </div>
        <div style={{ border: '1px solid #e2e8f0', padding: '1rem', borderRadius: '8px' }}>
          <h3 style={{ fontSize: '0.9rem', color: '#64748b', textTransform: 'uppercase' }}>Gates Configured</h3>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a' }}>{TOPOLOGY.gates.map(g => g.id).join(', ')}</p>
        </div>
      </div>
    </div>
  );
}
