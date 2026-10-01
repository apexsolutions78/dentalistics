import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  it('renders the title and sets the document title with the product suffix', () => {
    render(<PageHeader title="Clinic profile" subtitle="Address and hours" />);
    expect(screen.getByRole('heading', { name: 'Clinic profile' })).toBeInTheDocument();
    expect(screen.getByText('Address and hours')).toBeInTheDocument();
    expect(document.title).toBe('Clinic profile | Apex Dentalistics');
  });
});
