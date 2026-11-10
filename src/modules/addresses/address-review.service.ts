import { Injectable } from '@nestjs/common';
import { validateCity, validateStreet } from '../../common/utils/address-check';
import { ApprovedAddressesService } from './approved-addresses.service';

// First 3 digits of the PIN -> city / district (Tamil Nadu). Used only to suggest the right city in the message.
const PIN_PREFIX_CITY: Record<string, string> = {
  '600': 'Chennai', '601': 'Tiruvallur', '602': 'Tiruvallur', '603': 'Chengalpattu', '604': 'Viluppuram',
  '605': 'Viluppuram', '606': 'Tiruvannamalai', '607': 'Cuddalore', '608': 'Cuddalore', '609': 'Mayiladuthurai',
  '610': 'Tiruvarur', '611': 'Nagapattinam', '612': 'Kumbakonam', '613': 'Thanjavur', '614': 'Thanjavur',
  '620': 'Tiruchirappalli', '621': 'Tiruchirappalli', '622': 'Pudukkottai', '623': 'Ramanathapuram',
  '624': 'Dindigul', '625': 'Madurai', '626': 'Virudhunagar', '627': 'Tirunelveli', '628': 'Thoothukudi',
  '629': 'Nagercoil', '630': 'Sivaganga', '631': 'Kanchipuram', '632': 'Vellore', '635': 'Krishnagiri',
  '636': 'Salem', '637': 'Namakkal', '638': 'Erode', '639': 'Karur', '641': 'Coimbatore', '642': 'Tiruppur',
  '643': 'Udhagamandalam',
};

export interface AddressIssue {
  streetBad: boolean;
  cityBad: boolean;
  suggestedCity: string | null;
}

interface OrderAddress {
  id: string;
  addressStreet: string;
  addressCity: string;
  addressPincode: string;
}

/** Checks the address printed on an order and words the "please update your address" message for the customer. */
@Injectable()
export class AddressReviewService {
  constructor(private readonly approved: ApprovedAddressesService) {}

  /** What is wrong with the order's address (null when it looks complete or an admin approved it). */
  async review(order: OrderAddress): Promise<AddressIssue | null> {
    if (await this.approved.isApproved(order.addressStreet, order.addressCity, order.addressPincode)) return null;
    const streetBad = !!validateStreet(order.addressStreet || '');
    const cityBad = !!validateCity(order.addressCity || '');
    if (!streetBad && !cityBad) return null;
    return { streetBad, cityBad, suggestedCity: PIN_PREFIX_CITY[String(order.addressPincode || '').slice(0, 3)] ?? null };
  }

  buildMessage(order: OrderAddress, issue: AddressIssue): string {
    const parts: string[] = [];
    if (issue.cityBad) {
      parts.push(
        issue.suggestedCity
          ? `enter your city / district name (for PIN ${order.addressPincode} it is ${issue.suggestedCity})`
          : 'enter your city / district name',
      );
    }
    if (issue.streetBad) {
      parts.push('give the full address with door no., floor, street and area (for example: 12, 1st Floor, Sample Street, Demo Nagar)');
    }
    return `The delivery address on your order #${String(order.id).slice(0, 8)} is incomplete. Please ${parts.join(' and ')} so it reaches you without delay.`;
  }
}
