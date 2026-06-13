import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  revenueRangeMidpoint,
  employeeCountMidpoint,
  deriveDomain,
  isFreeEmailDomain,
} from '../src/utils/parse.js';

test('revenueRangeMidpoint parses ranges', () => {
  assert.equal(revenueRangeMidpoint('$1M-$5M'), 3_000_000);
  assert.equal(revenueRangeMidpoint('500k-1m'), 750_000);
  assert.equal(revenueRangeMidpoint('Under $250k'), 150_000);
  assert.equal(revenueRangeMidpoint('$10M+'), 15_000_000);
  assert.equal(revenueRangeMidpoint('nonsense'), null);
  assert.equal(revenueRangeMidpoint(''), null);
});

test('employeeCountMidpoint parses counts', () => {
  assert.equal(employeeCountMidpoint('11-50'), 31);
  assert.equal(employeeCountMidpoint('200+'), 250);
  assert.equal(employeeCountMidpoint('10'), 10);
  assert.equal(employeeCountMidpoint(42), 42);
  assert.equal(employeeCountMidpoint('none'), null);
});

test('deriveDomain prefers company email over webmail then name', () => {
  assert.equal(deriveDomain({ email: 'jane@acmewidgets.com' }), 'acmewidgets.com');
  assert.equal(deriveDomain({ email: 'jane@gmail.com', businessName: 'Acme Widgets Inc' }), 'acmewidgets.com');
  assert.equal(deriveDomain({ businessName: 'Bob & Co' }), 'bob.com');
  assert.equal(deriveDomain({}), null);
});

test('isFreeEmailDomain detects webmail', () => {
  assert.equal(isFreeEmailDomain('gmail.com'), true);
  assert.equal(isFreeEmailDomain('acme.com'), false);
});
