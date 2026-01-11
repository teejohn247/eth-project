import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { UtilityService } from '@shared/services/utility.service';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { CredoPaymentService } from '@shared/services/credo-payment.service';
import { NotificationService } from '@shared/services/notification.service';
import { SharedService } from '@shared/services/shared.service';

@Component({
  selector: 'app-tickets-sale',
  templateUrl: './tickets-sale.component.html',
  styleUrls: ['./tickets-sale.component.scss']
})
export class TicketsSaleComponent implements OnInit {

  isLoading: boolean = false;

  ticketTypes: any[] = [
    {
      id: 1,
      name: 'Regular',
      price: 10000,
      tier: 'bronze',
      quantity: 0
    },
    {
      id: 2,
      name: 'VIP for Couple',
      price: 50000,
      tier: 'gold',
      quantity: 0
    },
    {
      id: 3,
      name: 'Gold Table',
      price: 500000,
      tier: 'silver',
      quantity: 0
    },
    {
      id: 4,
      name: 'Sponsors Table',
      price: 1000000,
      tier: 'platinum',
      quantity: 0
    }
  ];

  buyerForm: FormGroup;

  constructor(
    private utilityService: UtilityService,
    private sharedService: SharedService,
    private paymentService: CredoPaymentService,
    private notifyService: NotificationService,
    private router: Router,
    private fb: FormBuilder
  ) {
    this.buyerForm = this.fb.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: ['']
    });
  }

  ngOnInit(): void {
    //this.getTicketTypes()
    // could initialize values or subscribe to changes if needed

    this.paymentService.ticketPayment$.subscribe(res => {
      this.isLoading = false; // ⛔ stop loading when payment finishes

      if (res.status === 'success') {
        this.notifyService.showSuccess('Ticket purchase successful!');
        console.log('Ticket Metadata:', res);

        // Reset form and quantities
        this.buyerForm.reset();
        this.ticketTypes.forEach(t => (t.quantity = 0));
      }

      else {
        this.notifyService.showError('Ticket purchase failed. Please try again.');
        console.log('Ticket Payment Error:', res);
      }
    });
  }

  contactForm() {
    this.utilityService.contactForm();
  }

  goToLogin() {
    this.router.navigate(['/login'], { queryParams: { action: 'login' } });
  }

  goToRegister() {
    this.router.navigate(['/login'], { queryParams: { action: 'create' } });
  }

  getTicketTypes() {
    this.sharedService.getAllTicketTypes().subscribe({
      next: res => {
        this.ticketTypes = res.data
      },
      error: err => {
        this.notifyService.showError('Could not retrieve ticket types. Please try again')
      }
    })
  }

  // increment/decrement
  increment(ticket: any) {
    ticket.quantity = (ticket.quantity || 0) + 1;
  }

  decrement(ticket: any) {
    ticket.quantity = Math.max(0, (ticket.quantity || 0) - 1);
  }

  // getters for summary
  get selectedTickets() {
    return this.ticketTypes.filter(t => t.quantity && t.quantity > 0);
  }

  get grandTotal() {
    return this.selectedTickets.reduce((sum, t) => sum + (t.price * t.quantity), 0);
  }

  // helper to map tier to class
  getTypeClass(ticket: any) {
    switch (ticket.tier) {
      case 'platinum': return 'platinum';
      case 'gold': return 'gold';
      case 'silver': return 'silver';
      case 'bronze':
      default:
        return 'bronze';
    }
  }

  trackById(index: number, item: any) {
    return item.id;
  }

  onSubmit() {
    // not performing payment here. Validate form and you can proceed to next step.
    if (this.buyerForm.invalid) {
      this.buyerForm.markAllAsTouched();
      return;
    }

    // Example payload you can send to backend or pass to payment flow
    const payload = {
      buyer: this.buyerForm.value,
      tickets: this.selectedTickets.map(t => ({ id: t.id, name: t.name, qty: t.quantity, lineTotal: t.price * t.quantity })),
      grandTotal: this.grandTotal
    };

    console.log('Purchase payload', payload);
    // For now we'll just log; you'll handle payment later.
  }

  makePayment() {
    if (this.buyerForm.invalid || !this.selectedTickets.length) {
      this.buyerForm.markAllAsTouched();
      this.notifyService.showError('Please fill in all necessary details');
      return;
    }

    this.isLoading = true; // ⏳ Start loading immediately on click

    const customer = {
      firstName: this.buyerForm.value.firstName,
      lastName: this.buyerForm.value.lastName,
      email: this.buyerForm.value.email,
      phone: this.buyerForm.value.phone
    };

    const metadata = {
      type: 'ticket_purchase',
      purchasePayload: this.buildTicketPurchaseMetadata(),
      tickets: this.selectedTickets.map(t => ({
        id: t.id,
        name: t.name,
        price: t.price,
        quantity: t.quantity
      }))
    };

    this.paymentService.startPayment(
      customer,
      this.grandTotal,
      metadata,
      window.location.origin + '/tickets'
    );
  }


  buildTicketPurchaseMetadata() {
    return {
      firstName: this.buyerForm.value.firstName,
      lastName: this.buyerForm.value.lastName,
      email: this.buyerForm.value.email,
      phone: this.buyerForm.value.phone,
      tickets: this.selectedTickets.map(t => ({
        ticketType: t.name?.toLowerCase(), // or t.type depending on your object
        quantity: t.quantity
      }))
    };
  }

}
