import { Injectable } from '@angular/core';
import { environment } from 'src/environments/environment';
import { SharedService } from './shared.service';
import { AuthService } from './auth.service';
import { UtilityService } from './utility.service';
import { NotificationService } from './notification.service';
import { Subject } from 'rxjs';

declare var CredoWidget: any;

@Injectable({
  providedIn: 'root'
})
export class CredoPaymentService {

  private handler: any;

  /** Emits results back to voting.component */
  private votePaymentSubject = new Subject<any>();
  votePayment$ = this.votePaymentSubject.asObservable();

  /** Emits results back to ticket-sale.component */
  private ticketPaymentSubject = new Subject<any>();
  ticketPayment$ = this.ticketPaymentSubject.asObservable();

  constructor(
    private sharedService: SharedService,
    private notifyService: NotificationService,
    private authService: AuthService,
    private utilityService: UtilityService
  ) {}

  /** Generate transaction reference */
  private generateRef(): string {
    const regNo = this.utilityService.registrationData 
      ? this.utilityService.registrationData.registrationNumber 
      : 'ETH202500003';

    const rand1 = this.generateRandom(10, 60);
    const rand2 = this.generateRandom(10, 90);

    return `${regNo}${rand1}hvc${rand2}`;
  }

  private generateRandom(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /** Parse callback result */
  private parsePaymentResult(url: string) {
    const parsedUrl = new URL(url);
    const params = Object.fromEntries(parsedUrl.searchParams.entries());

    return {
      reference: params['reference'] || '',
      transAmount: params['transAmount'] || '',
      transRef: params['transRef'] || '',
      processorFee: params['processorFee'] || '',
      errorMessage: params['errorMessage'] || '',
      currency: params['currency'] || '',
      gateway: params['gateway'] || '',
      status: params['status'] || ''
    };
  }

  /** Start payment (tickets, votes, etc.) */
  startPayment(
    customer: { firstName: string; lastName: string; email: string; phone?: string },
    amount: number,
    metadata?: any,
    callbackUrl: string = window.location.origin
  ) {
    const transRef = this.generateRef();

    this.handler = CredoWidget.setup({
      key: environment.credoApiKey,
      customerFirstName: customer.firstName,
      customerLastName: customer.lastName,
      email: customer.email,
      customerPhoneNumber: customer.phone || '',
      amount: amount * 100,
      currency: 'NGN',
      renderSize: 0,
      channels: ['card', 'bank'],
      reference: transRef,
      metadata,
      callbackUrl,

      onClose: () => {
        window.location.reload();
      },

      callBack: (response: any) => {
        const result = this.parsePaymentResult(response.callbackUrl);
        console.log('Result', result)
        this.verifyPayment(result.transRef, metadata);
      }
    });

    this.handler.openIframe();
  }

  /** Verify payment with backend */
  private verifyPayment(ref: string, metadata?: any) {
    this.sharedService.verifyCredoPayment(ref).subscribe({
      next: res => {

        /** Ticket purchase */
        if (metadata?.type === 'ticket_purchase') {
          this.confirmTicketPayment(res.data, metadata);
        }

        /** Vote purchase */
        else if (metadata?.type === 'vote_payment') {
          this.confirmVotePayment(res.data, metadata);
        }

        /** Standard registration purchase */
        else {
          this.confirmPayment(res.data);
        }
      },
      error: () => {
        this.notifyService.showError('Payment verification failed.');
      }
    });
  }

  /** Registration Purchase confirmation */
  private confirmPayment(paymentResult: any) {
    const userId = this.authService.loggedInUser?.id;

    this.sharedService.confirmPayment(paymentResult, userId).subscribe({
      next: res => this.notifyService.showSuccess(res.message),
      error: () => this.notifyService.showInfo('Payment was successful. Status will be updated soon.')
    });
  }

  /** Ticket Purchase confirmation */
  private confirmTicketPayment(paymentResult: any, metadata: any) {

    this.sharedService.verifyTicketPurchase(paymentResult, paymentResult.transRef).subscribe({

      next: verifyRes => {

        const isSuccess = verifyRes?.success;

        if (isSuccess) {

          this.sharedService.purchaseTicket(metadata.purchasePayload).subscribe({

            next: purchaseRes => {
              this.notifyService.showSuccess(
                purchaseRes.message || 'Ticket purchase successful.'
              );

              /** Emit success for UI */
              this.ticketPaymentSubject.next({
                status: 'success',
                ticketType: metadata.ticketType,
                quantity: metadata.quantity,
                amountPaid: metadata.amountPaid,
                ticketData: purchaseRes.data
              });
            },

            error: () => {
              this.notifyService.showInfo(
                'Payment verified but ticket registration failed. Support will resolve this shortly.'
              );

              /** Emit failure to UI */
              this.ticketPaymentSubject.next({
                status: 'failed',
                reason: 'ticket_registration_failed'
              });
            }

          });

        }

        else {
          this.notifyService.showInfo(
            'Payment verification failed. If you were debited, please contact support.'
          );

          /** Emit verification failure */
          this.ticketPaymentSubject.next({
            status: 'failed',
            reason: 'verification_failed'
          });
        }

      },

      error: () => {
        this.notifyService.showInfo(
          'Payment verification could not be completed. If you were debited, your ticket will be confirmed shortly.'
        );

        /** Emit network failure */
        this.ticketPaymentSubject.next({
          status: 'failed',
          reason: 'verification_error'
        });
      }

    });
  }

  /** VOTE PAYMENT CONFIRMATION */
  private confirmVotePayment(paymentResult: any, metadata: any) {
    console.log('Vote Details', paymentResult, metadata)

    this.sharedService.verifyVotePayment(paymentResult, paymentResult.transRef).subscribe({
      next: res => {
        console.log('Verify Details', res)

        // Notify UI
        this.notifyService.showSuccess(res.message || 'Vote purchase successful.');

        // Send response back to voting component
        this.votePaymentSubject.next({
          status: 'success',
          contestantId: metadata.contestantId,
          newVoteCount: res.data?.updatedVotes
        });
      },
      error: () => {

        // this.notifyService.showInfo(
        //   'Payment verified but vote allocation failed. Support will resolve this shortly.'
        // );

        this.votePaymentSubject.next({
          status: 'failed',
          contestantId: metadata.contestantId
        });

      }
    });
  }
}
