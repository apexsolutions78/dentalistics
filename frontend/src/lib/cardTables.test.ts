import { describe, expect, it } from 'vitest';
import { stampCardTables } from './cardTables';

describe('stampCardTables', () => {
  it('copies each column name onto the matching cell', () => {
    document.body.innerHTML = `
      <div class="table-cards">
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th aria-label="Actions"></th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Layla Hassan</td>
              <td><button type="button">Open</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
    stampCardTables(document.body);
    const cells = document.querySelectorAll('td');
    expect(cells[0]?.getAttribute('data-label')).toBe('Patient');
    expect(cells[1]?.getAttribute('data-label')).toBe('Actions');
  });
});
